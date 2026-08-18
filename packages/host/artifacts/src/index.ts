import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ArtifactReadResult } from './types.ts'
export type { ArtifactReadError, ArtifactReadOk, ArtifactReadResult } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { artifacts: ArtifactReader }
}

/**
 * Read-only workspace file reader for the Workbench Artifact panel. The panel
 * list comes from the Client session-event projection; this service only
 * serves instance content for a produced path. Paths arrive as the absolute
 * paths the official mutation tools publish; every read is sandboxed to the
 * session workspace.
 */
export class ArtifactReader extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'artifacts') }

  @Remote('read')
  async read(session: Session, path: string): Promise<ArtifactReadResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    try {
      const root = await realpath(cwd)
      const candidate = resolve(root, path)
      const rel = relative(root, candidate)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
        return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path is outside the session workspace.' }
      }
      const target = await realpath(candidate)
      const resolvedRel = relative(root, target)
      if (isAbsolute(resolvedRel) || resolvedRel === '..' || resolvedRel.startsWith(`..${sep}`)) {
        return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path resolves outside the session workspace.' }
      }
      return { ok: true, content: await readFile(target, 'utf8') }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { ok: false, code: 'NOT_FOUND', message: `File ${path} was not found.` }
      }
      return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

export default ArtifactReader
