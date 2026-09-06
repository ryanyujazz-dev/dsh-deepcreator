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
    const poll = hub.waitRequests(0, 'router-a')
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
    const reply = await hub.waitRequests(0, 'router-a')
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
      void hub.waitRequests(0, 'router-a').then(() => {})
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


  it('delivers a pushed request to exactly one of two parked routers', async () => {
    const hub = new AppRouterHub()
    // Two surfaces park: the user's browser first, the automation browser last.
    const browserA = hub.waitRequests(0, 'router-a')
    const browserB = hub.waitRequests(0, 'router-b')
    const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'createTask', params: {} }, 5_000)
    // The freshest router (b) receives it; the other poll stays parked.
    const replyB = await browserB
    expect(replyB.requests).toHaveLength(1)
    const loser = Symbol('loser')
    const replyA = await Promise.race([browserA.then(() => Symbol('resolved')), new Promise(resolve => setTimeout(() => resolve(loser), 20))])
    expect(replyA).toBe(loser)
    expect(hub.reportResult('r1', { result: true })).toBe(true)
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: { result: true } })
  })

  it('never re-delivers a claim owned by another router, even from an old cursor', async () => {
    const hub = new AppRouterHub()
    const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'x', params: {} }, 5_000)
    const mine = await hub.waitRequests(0, 'router-a')
    expect(mine.requests).toHaveLength(1)
    // Router b resumes from cursor 0: r1 is already claimed by a, so b's poll
    // finds nothing to deliver and parks (nothing arrives for 20 ms).
    const parked = hub.waitRequests(0, 'router-b')
    const loser = Symbol('loser')
    const theirs = await Promise.race([parked.then(reply => reply), new Promise(resolve => setTimeout(() => resolve(loser), 20))])
    expect(theirs).toBe(loser)
    expect(hub.reportResult('r1', {})).toBe(true)
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: {} })
  })

  it('re-delivers to the same router after its own cursor reset', async () => {
    const hub = new AppRouterHub()
    const pushed = hub.push({ kind: 'open', appId: 'a', version: '0.1.0', focus: false }, 5_000)
    await hub.waitRequests(0, 'router-a')
    // The same surface crashed mid-handling and re-polls from 0: it may retry its own claim.
    const again = await hub.waitRequests(0, 'router-a')
    expect(again.requests.map(request => request.requestId)).toEqual(['r1'])
    expect(hub.reportResult('r1', { opened: true })).toBe(true)
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: { opened: true } })
  })

  it('delivers to the active router when the push lands between its polls', async () => {
    const hub = new AppRouterHub()
    // Router a completes one empty cadence poll (it is now the active router,
    // parked for nothing — the macrotask gap between poll rounds).
    vi.useFakeTimers()
    let first: { requests: unknown[]; cursor: number } | undefined
    try {
      const parked = hub.waitRequests(0, 'router-a')
      await vi.advanceTimersByTimeAsync(0)
      void parked.then(reply => { first = reply })
      await vi.advanceTimersByTimeAsync(25_100)
    } finally {
      vi.useRealTimers()
    }
    expect(first).toEqual({ requests: [], cursor: 0 })
    // The push claims r1 for router a while a has nothing parked.
    const pushed = hub.push({ kind: 'invoke', appId: 'a', version: '0.1.0', action: 'x', params: {} }, 5_000)
    // a's next poll still resumes from its last cursor (0) and must receive r1:
    // the claim names a, and a's cursor has not advanced past r1.
    const next = await hub.waitRequests(0, 'router-a')
    expect(next.requests.map(request => request.requestId)).toEqual(['r1'])
    expect(hub.reportResult('r1', { result: true })).toBe(true)
    await expect(pushed).resolves.toEqual({ kind: 'reported', outcome: { result: true } })
  })

  it('reports outcome error codes through unchanged', async () => {
    const hub = new AppRouterHub()
    const poll = hub.waitRequests(0, 'router-a')
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
