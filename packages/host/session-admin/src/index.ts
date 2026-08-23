import { readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Type-only: pulls the `sessions` Context merge into this program.
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import type { SessionDeleteResult } from './types.ts'
export type { SessionDeleteError, SessionDeleteOk, SessionDeleteResult } from './types.ts'

/** Official session ids are `session-<uuid>`; reject anything else before touching the disk. */
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Session lifecycle administration the official harness does not expose.
 * `delete` destroys one persisted session: its directory under the shared
 * sessions root (the official jsonl backend names each session directory by
 * the raw id — a UUID needs no escaping). Every live session is refused: the
 * official Session owner is the only holder of its teardown capability, and
 * deleting its artifact underneath that owner would leave `session.list`
 * authoritative for the still-live row and allow later writes to recreate it.
 */
export class SessionAdmin extends TypertRemoteService {
  /** Required service: the official live-session registry. */
  static inject = ['sessions']

  constructor(ctx: Context) { super(ctx, 'session-admin') }

  @Remote('delete')
  async delete(sessionId: string): Promise<SessionDeleteResult> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return { ok: false, code: 'INVALID_ID', message: `Session id ${sessionId} is not a valid session id.` }
    }
    const live = this.ctx.sessions.get(sessionId as SessionId)
    if (live !== undefined) {
      return { ok: false, code: 'SESSION_ACTIVE', message: 'Session is open; restart the Host before deleting it.' }
    }
    const root = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
    const matches: string[] = []
    try {
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const candidate = resolve(root, entry.name, sessionId)
        const relative = candidate.slice(root.length).replace(/^[\\/]/, '')
        const segments = relative.split(sep)
        if (segments.length !== 2 || segments[1] !== sessionId) continue
        if (await sessionArtifactExists(candidate)) matches.push(candidate)
      }
    } catch (error) {
      return { ok: false, code: 'NOT_FOUND', message: `Sessions root is unreadable: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (matches.length === 0) {
      return { ok: false, code: 'NOT_FOUND', message: `Session ${sessionId} was not found.` }
    }
    if (matches.length > 1) {
      return { ok: false, code: 'AMBIGUOUS', message: `Session ${sessionId} exists in multiple workspaces; refusing to delete.` }
    }
    const target = matches[0]!
    await rm(target, { recursive: true, force: true })
    return { ok: true, deletedPath: target }
  }
}

async function sessionArtifactExists(sessionDir: string): Promise<boolean> {
  try {
    const entries = await readdir(sessionDir)
    return entries.includes('session.jsonl') || entries.includes('session.jsonl.zstd')
  } catch {
    return false
  }
}

export default SessionAdmin
