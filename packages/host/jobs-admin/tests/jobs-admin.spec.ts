import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { JobsAdmin } from '../src/index.ts'
import type { JobStopResult } from '../src/types.ts'

const SESSION = 'session-11111111-2222-4333-8444-555555555555'
const CHILD = 'session-99999999-8888-4777-8666-555555555555'

interface JobEntry {
  id: string
  status: string
}

interface LiveSession {
  events: Array<{ seq: number; time?: number; type: string; data?: unknown }>
}

interface CatalogChild {
  kind: 'child'
  id: string
  activity: string
  mode: string
  label: string
}

interface AdminUnderTest {
  admin: JobsAdmin
  kill: ReturnType<typeof vi.fn>
}

/** Mount the admin over fake registries holding one agent's job set. */
function makeAdmin(options: {
  jobs?: JobEntry[]
  agentLive?: boolean
  liveSessions?: Record<string, LiveSession>
  catalogChildren?: CatalogChild[]
  catalogThrows?: Error
} = {}): AdminUnderTest {
  const { jobs = [], agentLive = true, liveSessions = {}, catalogChildren = [], catalogThrows } = options
  const ctx = new Context()
  ;(ctx as unknown as { agents: unknown }).agents = {
    get: (id: string) => {
      if (id === SESSION) return agentLive ? { id: SESSION } : undefined
      return undefined
    },
  }
  const kill = vi.fn()
  ;(ctx as unknown as { jobs: unknown }).jobs = {
    list: (agent: { id: string }) => jobs.map(job => ({ ...job })),
    kill,
  }
  ;(ctx as unknown as { sessions: unknown }).sessions = {
    get: (id: string) => {
      const entry = liveSessions[id]
      return entry === undefined ? undefined : { events: entry.events }
    },
  }
  ;(ctx as unknown as { subagents: unknown }).subagents = {
    listChildren: async () => {
      if (catalogThrows !== undefined) throw catalogThrows
      return catalogChildren
    },
  }
  return { admin: new JobsAdmin(ctx), kill }
}

describe('JobsAdmin.stop', () => {
  it('kills a running job owned by the session', async () => {
    const { admin, kill } = makeAdmin({ jobs: [{ id: 'bash-3', status: 'running' }] })
    await expect(admin.stop(SESSION, 'bash-3')).resolves.toEqual({ ok: true })
    expect(kill).toHaveBeenCalledExactlyOnceWith('bash-3', { id: SESSION }, 'user-stop')
  })

  it('forwards a stop request for a stopping job and stays idempotent', async () => {
    const { admin, kill } = makeAdmin({ jobs: [{ id: 'subagent-1', status: 'stopping' }] })
    await expect(admin.stop(SESSION, 'subagent-1')).resolves.toEqual({ ok: true })
    expect(kill).toHaveBeenCalledExactlyOnceWith('subagent-1', { id: SESSION }, 'user-stop')
  })

  it('rejects malformed ids before touching the registries', async () => {
    const { admin, kill } = makeAdmin()
    expect(await admin.stop('not-a-session', 'bash-1')).toMatchObject({ ok: false, code: 'INVALID_SESSION' })
    expect(await admin.stop(SESSION, '../etc/passwd')).toMatchObject({ ok: false, code: 'INVALID_JOB' })
    expect(kill).not.toHaveBeenCalled()
  })

  it('reports a missing agent as SESSION_GONE', async () => {
    const { admin } = makeAdmin({ jobs: [{ id: 'bash-3', status: 'running' }], agentLive: false })
    await expect(admin.stop(SESSION, 'bash-3')).resolves.toMatchObject({ ok: false, code: 'SESSION_GONE' })
  })

  it('reports jobs outside the owner list as JOB_NOT_FOUND', async () => {
    const { admin, kill } = makeAdmin({ jobs: [{ id: 'bash-3', status: 'running' }] })
    await expect(admin.stop(SESSION, 'bash-4')).resolves.toMatchObject({ ok: false, code: 'JOB_NOT_FOUND' })
    expect(kill).not.toHaveBeenCalled()
  })

  it('refuses settled jobs as NOT_LIVE', async () => {
    const { admin, kill } = makeAdmin({ jobs: [{ id: 'bash-3', status: 'completed' }] })
    await expect(admin.stop(SESSION, 'bash-3')).resolves.toMatchObject({ ok: false, code: 'NOT_LIVE' })
    expect(kill).not.toHaveBeenCalled()
  })

  it('folds a throwing kill into KILL_FAILED', async () => {
    const { admin } = makeAdmin({ jobs: [{ id: 'bash-3', status: 'running' }] })
    ;(admin as unknown as { ctx: { jobs: { kill: () => void } } }).ctx.jobs.kill = () => { throw new Error('boom') }
    const result: JobStopResult = await admin.stop(SESSION, 'bash-3')
    expect(result).toMatchObject({ ok: false, code: 'KILL_FAILED' })
    expect((result as { message?: string }).message).toContain('boom')
  })
})

describe('JobsAdmin.subagentOverview', () => {
  const T0 = 1_700_000_000_000

  /** Parent log carrying one user turn, one context injection, then a newer user turn. */
  const parentLog = [
    { seq: 0, time: T0, type: 'user/message', data: { source: { kind: 'user' } } },
    { seq: 1, time: T0 + 10, type: 'user/message', data: { source: { kind: 'context' } } },
    { seq: 2, time: T0 + 20, type: 'assistant/message', data: {} },
    { seq: 3, time: T0 + 30, type: 'user/message', data: { source: { kind: 'user' } } },
  ]

  it('serves per-child recency plus the latest user-authored turn boundary', async () => {
    const { admin } = makeAdmin({
      liveSessions: {
        [SESSION]: { events: parentLog },
        [CHILD]: { events: [{ seq: 0, time: T0 + 40, type: 'turn/start' }] },
      },
      catalogChildren: [{ kind: 'child', id: CHILD, activity: 'running', mode: 'continuable', label: 'writer' }],
    })
    await expect(admin.subagentOverview(SESSION)).resolves.toEqual({
      ok: true,
      turnStartedAt: T0 + 30,
      children: [{ id: CHILD, running: true, lastActiveAt: T0 + 40 }],
    })
  })

  it('keeps cold catalog children without a lastActiveAt', async () => {
    const { admin } = makeAdmin({
      liveSessions: { [SESSION]: { events: parentLog } },
      catalogChildren: [{ kind: 'child', id: CHILD, activity: 'inactive', mode: 'one-shot', label: 'gone' }],
    })
    const result = await admin.subagentOverview(SESSION)
    expect(result).toEqual({ ok: true, turnStartedAt: T0 + 30, children: [{ id: CHILD, running: false }] })
  })

  it('omits turnStartedAt when the parent log has no user-authored message', async () => {
    const { admin } = makeAdmin({
      liveSessions: { [SESSION]: { events: [{ seq: 0, time: T0, type: 'assistant/message', data: {} }] } },
    })
    const result = await admin.subagentOverview(SESSION)
    expect(result).toEqual({ ok: true, children: [] })
  })

  it('folds a failing enumeration into READ_FAILED', async () => {
    const { admin } = makeAdmin({
      liveSessions: { [SESSION]: { events: parentLog } },
      catalogThrows: new Error('registry down'),
    })
    await expect(admin.subagentOverview(SESSION)).resolves.toMatchObject({ ok: false, code: 'READ_FAILED' })
  })

  it('fences ids and missing parents before enumeration', async () => {
    const { admin } = makeAdmin()
    await expect(admin.subagentOverview('nope')).resolves.toMatchObject({ ok: false, code: 'INVALID_SESSION' })
    await expect(admin.subagentOverview(SESSION)).resolves.toMatchObject({ ok: false, code: 'PARENT_GONE' })
  })
})
