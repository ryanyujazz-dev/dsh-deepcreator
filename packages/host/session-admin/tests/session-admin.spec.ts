import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionAdmin } from '../src/index.ts'

const temporary: string[] = []
const originalDshHome = process.env.DSH_HOME
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
})

/** Build a fake sessions root shaped like the official jsonl backend. */
async function makeAdmin({
  runningIds = [],
  liveIds = [],
}: { runningIds?: string[]; liveIds?: string[] } = {}): Promise<AdminUnderTest> {
  const dshHome = await mkdtemp(join(tmpdir(), 'dsh-session-admin-')); temporary.push(dshHome)
  process.env.DSH_HOME = dshHome
  const ctx = new Context()
  ;(ctx as unknown as { agents: unknown }).agents = {
    get: (id: string) => (runningIds.includes(id) || liveIds.includes(id) ? { id } : undefined),
  }
  ;(ctx as unknown as { jobs: unknown }).jobs = {
    list: (agent: { id: string }) => (runningIds.includes(agent.id)
      ? [{ status: 'running' }]
      : []),
  }
  ;(ctx as unknown as { sessions: unknown }).sessions = {
    get: (id: string) => (liveIds.includes(id) ? { id } : undefined),
    flush: vi.fn(async () => undefined),
  }
  const admin = new SessionAdmin(ctx)
  return { admin, dshHome }
}

async function seedSession(dshHome: string, projectKey: string, sessionId: string): Promise<string> {
  const dir = join(dshHome, 'sessions', projectKey, sessionId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'session.jsonl'), JSON.stringify({ version: 0 }))
  return dir
}

describe('SessionAdmin.delete', () => {
  it('destroys the session directory under its project key', async () => {
    const { admin, dshHome } = await makeAdmin()
    const dir = await seedSession(dshHome, '--E-repo--', 'session-11111111-2222-4333-8444-555555555555')
    const result = await admin.delete('session-11111111-2222-4333-8444-555555555555')
    expect(result).toEqual({ ok: true, deletedPath: dir })
    await expect(rm(dir, { recursive: true })).rejects.toThrow()
  })

  it('refuses non-session ids before touching the disk', async () => {
    const { admin } = await makeAdmin()
    expect(await admin.delete('not-a-uuid')).toMatchObject({ ok: false, code: 'INVALID_ID' })
    expect(await admin.delete('../../etc/passwd')).toMatchObject({ ok: false, code: 'INVALID_ID' })
  })

  it('refuses running sessions and flushes idle live sessions before deleting', async () => {
    const { admin } = await makeAdmin({ runningIds: ['session-11111111-2222-4333-8444-555555555555'] })
    expect(await admin.delete('session-11111111-2222-4333-8444-555555555555')).toMatchObject({ ok: false, code: 'SESSION_ACTIVE' })
  })

  it('deletes an idle open session after flushing its durability checkpoint', async () => {
    const { admin, dshHome } = await makeAdmin({ liveIds: ['session-11111111-2222-4333-8444-555555555555'] })
    const dir = await seedSession(dshHome, '--E-repo--', 'session-11111111-2222-4333-8444-555555555555')
    const result = await admin.delete('session-11111111-2222-4333-8444-555555555555')
    expect(result).toEqual({ ok: true, deletedPath: dir })
    await expect(rm(dir, { recursive: true })).rejects.toThrow()
  })

  it('reports missing sessions and ignores lookalike directories', async () => {
    const { admin, dshHome } = await makeAdmin()
    await seedSession(dshHome, '--E-repo--', 'session-11111111-2222-4333-8444-555555555555')
    // A directory named like a session without the log artifact is not a session.
    await mkdir(join(dshHome, 'sessions', '--E-other--', 'session-22222222-3333-4444-8555-666666666666'), { recursive: true })
    expect(await admin.delete('session-99999999-0000-4111-8222-333333333333')).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    expect(await admin.delete('session-22222222-3333-4444-8555-666666666666')).toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('refuses when the session id exists under multiple workspaces', async () => {
    const { admin, dshHome } = await makeAdmin()
    const id = 'session-11111111-2222-4333-8444-555555555555'
    await seedSession(dshHome, '--E-one--', id)
    await seedSession(dshHome, '--E-two--', id)
    expect(await admin.delete(id)).toMatchObject({ ok: false, code: 'AMBIGUOUS' })
  })
})
