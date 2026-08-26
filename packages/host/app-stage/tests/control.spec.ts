/**
 * M4 operation-face tests: the router hub's queue/cursor/park/settlement
 * mechanics, and the service `invoke`/`open` remotes' validation, journal
 * diffing, and timeout semantics over a real install store.
 * @module @ryanyujazz/dsh-app-stage/tests/control.spec
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { AppRouterHub, ROUTER_PRESENCE_GRACE_MS } from '../src/control.ts'
import { appDataSet, appDataGet } from '../src/appdata.ts'
import type { AppRouterOutcome } from '../src/types.ts'

const timers: ReturnType<typeof setTimeout>[] = []

afterAll(() => { for (const timer of timers) clearTimeout(timer) })

describe('AppRouterHub', () => {
  it('delivers pushed requests to a parked poll and resolves on report', async () => {
    const hub = new AppRouterHub()
    const poll = hub.waitRequests(0)
    const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'createTask', params: {} }, 5_000)
    const reply = await poll
    expect(reply.requests).toHaveLength(1)
    expect(reply.requests[0]!.appId).toBe('a')
    expect(reply.cursor).toBe(1)
    expect(hub.reportResult('r1', { result: { id: 'n-1' } })).toBe(true)
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: { result: { id: 'n-1' } } })
  })

  it('re-delivers missed requests by cursor and acks unknown ids', async () => {
    const hub = new AppRouterHub()
    const pushed = hub.push({ kind: 'open', appId: 'a', version: '0.1.0', focus: true }, 5_000)
    // No poller was parked; a later poll resumes from cursor 0.
    const reply = await hub.waitRequests(0)
    expect(reply.requests.map(request => request.requestId)).toEqual(['r1'])
    expect(hub.reportResult('r-nope', {})).toBe(false)
    expect(hub.reportResult('r1', { opened: true, focused: true })).toBe(true)
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: { opened: true, focused: true } })
    // A second report of the same id is idempotently unknown.
    expect(hub.reportResult('r1', {})).toBe(false)
  })

  it('settles by timeout when no router ever reports', async () => {
    vi.useFakeTimers()
    try {
      const hub = new AppRouterHub()
      // Connect a router so the presence grace does not fire.
      void hub.waitRequests(0).then(() => {})
      const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'x', params: {} }, 30)
      const settled = pushed
      setTimeout(() => {}, 0)
      await vi.advanceTimersByTimeAsync(31)
      await expect(settled).resolves.toEqual({ kind: 'timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles as unavailable when no router is connected within the grace', async () => {
    vi.useFakeTimers()
    try {
      const hub = new AppRouterHub()
      const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'x', params: {} }, 30_000)
      await vi.advanceTimersByTimeAsync(ROUTER_PRESENCE_GRACE_MS + 1)
      await expect(pushed).resolves.toEqual({ kind: 'unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports outcome error codes through unchanged', async () => {
    const hub = new AppRouterHub()
    const poll = hub.waitRequests(0)
    const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'x', params: {} }, 5_000)
    await poll
    hub.reportResult('r1', { error: { code: 'ACTION_NOT_REGISTERED', message: 'never registered' } })
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: { error: { code: 'ACTION_NOT_REGISTERED', message: 'never registered' } } })
  })
})

describe('journal diff feeds persistedKeys (service-level contract)', () => {
  it('unique paths after the pre-rev are exactly the write set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appstage-diff-'))
    try {
      const { appDataChanges } = await import('../src/appdata.ts')
      await appDataSet('installed', 'a', 'board.items', [{ title: 'one' }], 'c1', undefined, '1', root)
      const before = (await appDataGet('installed', 'a', undefined, undefined, '1', root)).rev
      await appDataSet('installed', 'a', 'board.title', 'T', 'c2', undefined, '1', root)
      await appDataSet('installed', 'a', 'board.title', 'T2', 'c3', undefined, '1', root)
      const changes = await appDataChanges('installed', 'a', before, undefined, root)
      expect([...new Set(changes.map(change => change.path))]).toEqual(['board.title'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('invoke param validation (service-level contract)', () => {
  it('rejects extras and mistyped keys before any routing', async () => {
    const { validateInvokeParams } = await import('../src/params.ts')
    const decl = { title: 'string', count: 'number?', payload: 'json' }
    expect(validateInvokeParams({ title: 'x' }, decl)).toEqual({ ok: true })
    expect(validateInvokeParams({}, decl)).toEqual({ ok: true })
    expect(validateInvokeParams({ payload: [1, { a: true }] }, decl)).toEqual({ ok: true })
    expect(validateInvokeParams({ extra: 1 }, decl).ok).toBe(false)
    expect(validateInvokeParams({ title: 5 }, decl).ok).toBe(false)
    expect(validateInvokeParams({ count: 'x' }, decl).ok).toBe(false)
    expect(validateInvokeParams({ count: null }, decl)).toEqual({ ok: true })
  })

  it('rejects any params when the action declares none', async () => {
    const { validateInvokeParams } = await import('../src/params.ts')
    expect(validateInvokeParams({}, undefined)).toEqual({ ok: true })
    expect(validateInvokeParams(null, undefined)).toEqual({ ok: true })
    expect(validateInvokeParams({ a: 1 }, undefined).ok).toBe(false)
  })
})
