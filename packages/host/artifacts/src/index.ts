import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ArtifactDeclareRequest, ArtifactListResult, ArtifactReadResult, ArtifactRecord } from './types.ts'
export type { ArtifactDeclareRequest, ArtifactListResult, ArtifactLocator, ArtifactReadResult, ArtifactRecord } from './types.ts'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'artifact/declared': { artifact: ArtifactRecord }
    'artifact/revised': { artifact: ArtifactRecord }
    'artifact/status': { id: string; revision: string; status: ArtifactRecord['status']; updatedAt: number }
    'artifact/removed': { id: string; revision: string; updatedAt: number }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { artifacts: ArtifactRegistry }
}

function detached(record: ArtifactRecord): ArtifactRecord {
  return { ...record, locator: { ...record.locator } }
}

export function foldArtifacts(session: Session): ArtifactRecord[] {
  const records = new Map<string, ArtifactRecord>()
  for (const event of session.events) {
    switch (event.type) {
      case 'artifact/declared':
      case 'artifact/revised': {
        const value = event.data.artifact
        if (value.sessionId !== session.id) throw new Error(`artifact ${value.id} belongs to another session`)
        records.set(value.id, detached(value))
        break
      }
      case 'artifact/status': {
        const current = records.get(event.data.id)
        if (current !== undefined) records.set(current.id, { ...current, revision: event.data.revision, status: event.data.status, updatedAt: event.data.updatedAt })
        break
      }
      case 'artifact/removed': records.delete(event.data.id); break
    }
  }
  return [...records.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(detached)
}

function normalizedTitle(value: string): string {
  const title = value.trim()
  if (title.length === 0) throw new Error('artifact title must not be empty')
  return title
}

/** Host Artifact Registry (`ctx.artifacts`). */
export class ArtifactRegistry extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'artifacts') }

  declare(agent: Agent, request: ArtifactDeclareRequest): ArtifactRecord {
    const now = Date.now()
    const record: ArtifactRecord = {
      id: request.id ?? randomUUID(),
      sessionId: agent.id,
      kind: request.kind,
      title: normalizedTitle(request.title),
      locator: { ...request.locator },
      revision: randomUUID(),
      status: request.status ?? 'ready',
      createdAt: now,
      updatedAt: now,
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(request.mime === undefined ? {} : { mime: request.mime }),
    }
    if (foldArtifacts(agent.session).some(item => item.id === record.id)) throw new Error(`artifact ${record.id} already exists`)
    agent.session.append('artifact/declared', { artifact: record })
    return detached(record)
  }

  revise(agent: Agent, id: string, request: ArtifactDeclareRequest): ArtifactRecord {
    const current = foldArtifacts(agent.session).find(item => item.id === id)
    if (current === undefined) throw new Error(`artifact ${id} does not exist`)
    const record: ArtifactRecord = {
      ...current,
      kind: request.kind,
      title: normalizedTitle(request.title),
      locator: { ...request.locator },
      revision: randomUUID(),
      status: request.status ?? current.status,
      updatedAt: Date.now(),
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      ...(request.mime === undefined ? {} : { mime: request.mime }),
    }
    agent.session.append('artifact/revised', { artifact: record })
    return detached(record)
  }

  setStatus(agent: Agent, id: string, status: ArtifactRecord['status']): ArtifactRecord {
    const current = foldArtifacts(agent.session).find(item => item.id === id)
    if (current === undefined) throw new Error(`artifact ${id} does not exist`)
    const revision = randomUUID()
    const updatedAt = Date.now()
    agent.session.append('artifact/status', { id, revision, status, updatedAt })
    return { ...current, revision, status, updatedAt }
  }

  remove(agent: Agent, id: string): boolean {
    if (!foldArtifacts(agent.session).some(item => item.id === id)) return false
    agent.session.append('artifact/removed', { id, revision: randomUUID(), updatedAt: Date.now() })
    return true
  }

  @Remote('list')
  list(session: Session): ArtifactListResult {
    try { return { ok: true, artifacts: foldArtifacts(session) } }
    catch (error) { return { ok: false, code: 'INVALID_LOG', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('read')
  async read(session: Session, id: string): Promise<ArtifactReadResult> {
    const artifact = foldArtifacts(session).find(item => item.id === id)
    if (artifact === undefined) return { ok: false, code: 'NOT_FOUND', message: `Artifact ${id} was not found.` }
    if (artifact.locator.type !== 'workspace-path') return { ok: false, code: 'UNSUPPORTED_LOCATOR', message: `Locator ${artifact.locator.type} is not readable by this provider.` }
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    try {
      const root = await realpath(cwd)
      const candidate = resolve(root, artifact.locator.path)
      const target = await realpath(candidate)
      const rel = relative(root, target)
      if (isAbsolute(artifact.locator.path) || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path is outside the session workspace.' }
      }
      return { ok: true, artifact, content: await readFile(target, 'utf8') }
    } catch (error) {
      return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

export default ArtifactRegistry
