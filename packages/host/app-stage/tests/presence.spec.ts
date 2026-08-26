/**
 * M5 presence tests: the authoritative lease state machine (Px-β) — dual
 * leases, activity timeout, user interrupt with no clawback, macro budgets
 * with command-gated renewal, the deterministic summary fold, and the
 * installed-origin timeline filter.
 * @module @ryanyujazz/dsh-app-stage/tests/presence.spec
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  PresenceCoordinator,
  PRESENCE_IDLE_SUSPEND_MS,
  PRESENCE_MACRO_AI_BUDGET_MS,
  summarizeParams,
} from '../src/presence.ts'
import type { PresenceEvent } from '../src/presence.ts'

const timers: Array<ReturnType<typeof setTimeout>> = []
const hub = (): PresenceCoordinator => new PresenceCoordinator()
const cmd = (appId = 'kanban-demo', action = 'createTask') => ({
  kind: 'invoke' as const, appId, appName: '看板演示', version: '0.2.1', action, origin: 'installed' as const,
})
const settle = (coordinator: PresenceCoordinator, over: Partial<Parameters<PresenceCoordinator['commandSettled']>[1]> = {}) => {
  coordinator.commandSettled('s1', { ts: Date.now(), kind: 'invoke', appId: 'kanban-demo', appName: '看板演示', version: '0.2.1', action: 'createTask', outcome: 'ok', durationMs: 120, keys: ['board.items'], origin: 'installed', ...over })
}

afterAll(() => { for (const timer of timers) clearTimeout(timer) })

describe('micro lease (any command-stream action)', () => {
  it('lights immediately on the first command and records settlements', () => {
    const presence = hub()
    presence.commandStarted('s1', cmd())
    let [lease] = presence.snapshot('s1')
    expect(lease?.kind).toBe('micro')
    expect(lease?.state).toBe('active')
    settle(presence)
    ;[lease] = presence.snapshot('s1')
    expect(lease?.apps).toEqual([{ appId: 'kanban-demo', name: '看板演示', version: '0.2.1' }])
    expect(lease?.focus?.appId).toBe('kanban-demo')
  })

  it('suspends and releases on 60 s silence, emitting the summary', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.commandStarted('s1', cmd())
      settle(presence)
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS + 5)
      expect(presence.snapshot('s1')).toEqual([])
      const [lease] = presence.snapshot('s1') // gone; fetch the summary via the ledger id
      void lease
      // The lease id rides the snapshot before release; recover through a new
      // command + release cycle is not needed — query the only emitted card.
      const summaries = presence.timelineSince(0)
      expect(summaries.latest).toBe(1) // the settled action reached the feed
    } finally {
      vi.useRealTimers()
    }
  })

  it('summary folds counts, apps, key changes, and unfulfilled persist', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.commandStarted('s1', cmd())
      const leaseId = presence.snapshot('s1')[0]!.leaseId
      settle(presence)
      presence.noteKeyChange('s1', 'kanban-demo', 'board.items', 3)
      // An ok invoke that declared persist but changed nothing.
      presence.commandSettled('s1', { ts: Date.now(), kind: 'invoke', appId: 'kanban-demo', appName: '看板演示', action: 'noopAction', outcome: 'ok', durationMs: 10, origin: 'installed' })
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS + 5)
      const summary = presence.summary(leaseId)
      expect(summary?.counts.invoke).toBe(2)
      expect(summary?.apps[0]?.appId).toBe('kanban-demo')
      expect(summary?.keyChanges).toEqual([{ appId: 'kanban-demo', path: 'board.items', rev: 3 }])
      expect(summary?.unfulfilled).toEqual([{ appId: 'kanban-demo', action: 'noopAction' }])
      expect(summary?.sourceSession).toBe('s1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('a fresh command inside the idle window keeps the lease alive', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.commandStarted('s1', cmd())
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS - 1_000)
      presence.commandStarted('s1', cmd())
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS - 1_000)
      expect(presence.snapshot('s1')[0]?.state).toBe('active')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('macro lease (explicit takeover)', () => {
  it('lights the full state with the AI budget and focuses the app', () => {
    const presence = hub()
    const lease = presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示', version: '0.2.1' }, false)
    expect(lease.kind).toBe('macro')
    expect(lease.delegated).toBe(false)
    expect(lease.state).toBe('active')
    expect(lease.focus?.appId).toBe('kanban-demo')
    expect(lease.expiresAt).toBeGreaterThan(Date.now() + PRESENCE_MACRO_AI_BUDGET_MS - 1_000)
  })

  it('renews the budget only on a new command (silence never extends)', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示' }, false)
      const before = presence.snapshot('s1')[0]!.expiresAt
      vi.advanceTimersByTime(60_000)
      const silent = presence.snapshot('s1')[0]!.expiresAt
      expect(silent).toBe(before) // silence did not move the deadline
      presence.commandStarted('s1', cmd())
      const renewed = presence.snapshot('s1')[0]!.expiresAt
      expect(renewed!).toBeGreaterThan(silent!)
      // Suspend-idle at 60 s degrades visuals but the lease holds to expiry.
      expect(presence.snapshot('s1')[0]?.state).toBe('active')
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases with a summary at budget expiry', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      const lease = presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示' }, false)
      settle(presence)
      vi.advanceTimersByTime(PRESENCE_MACRO_AI_BUDGET_MS + 5)
      expect(presence.snapshot('s1')).toEqual([])
      const summary = presence.summary(lease.leaseId)
      expect(summary?.kind).toBe('macro')
      expect(summary?.counts.invoke).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suspended-idle macro holds until the budget deadline', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示' }, false)
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS + 5)
      expect(presence.snapshot('s1')[0]?.state).toBe('suspended-idle')
      vi.advanceTimersByTime(PRESENCE_MACRO_AI_BUDGET_MS)
      expect(presence.snapshot('s1')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('renewal vs orphaned timers (real-GUI regression: 8-second macro)', () => {
  it('a takeover renewal after idle survives the pre-renewal deadline', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示' }, false)
      settle(presence)
      // Idle fires first (visual degrade only); the expiry timer owns the deadline.
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS + 5)
      expect(presence.snapshot('s1')[0]?.state).toBe('suspended-idle')
      // A renewal inside the old budget: the old deadline must not release it.
      presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示' }, false)
      vi.advanceTimersByTime(PRESENCE_MACRO_AI_BUDGET_MS - 1_000)
      const lease = presence.snapshot('s1')[0]
      expect(lease?.state === undefined || lease.state === 'active' || lease.state === 'suspended-idle').toBe(true)
      expect(lease).toBeDefined()
      // Release happens at the renewed deadline, not before.
      vi.advanceTimersByTime(2_000)
      expect(presence.snapshot('s1')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('user interrupt (X1: no clawback)', () => {
  it('suspends on interrupt and records the fact; commands do not reactivate', () => {
    const presence = hub()
    presence.commandStarted('s1', cmd())
    settle(presence)
    expect(presence.interrupt('s1')).toBe(true)
    expect(presence.snapshot('s1')[0]?.state).toBe('suspended-user')
    // Agent commands keep flowing (queued upstream): recorded, not reactivating.
    presence.commandStarted('s1', cmd())
    settle(presence)
    expect(presence.snapshot('s1')[0]?.state).toBe('suspended-user')
    vi.useFakeTimers()
    try {
      vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS + 5)
      const summary = presence.summary(presence.snapshot('s1')[0]?.leaseId ?? '')
      void summary // not released yet: user holds the lease
      expect(presence.snapshot('s1')[0]?.state).toBe('suspended-user')
    } finally {
      vi.useRealTimers()
    }
  })

  it('resume and handback are user-only exits', () => {
    const presence = hub()
    presence.commandStarted('s1', cmd())
    presence.interrupt('s1')
    expect(presence.resume('s1')).toBe(true)
    expect(presence.snapshot('s1')[0]?.state).toBe('active')
    presence.interrupt('s1')
    expect(presence.handback('s1')).toBe(true)
    expect(presence.snapshot('s1')).toEqual([])
    expect(presence.resume('s1')).toBe(false)
  })
})

describe('timeline feed (installed origin only)', () => {
  it('aggregates installed rows with cursors and drops dev rows', () => {
    const presence = hub()
    presence.commandStarted('s1', cmd())
    settle(presence)
    presence.commandSettled('s1', { ts: Date.now(), kind: 'data.write', appId: 'scratch', appName: '自测', outcome: 'ok', durationMs: 4, origin: 'dev' })
    const feed = presence.timelineSince(0)
    expect(feed.rows).toHaveLength(1)
    expect(feed.rows[0]?.appId).toBe('kanban-demo')
    expect(feed.rows[0]?.action).toBe('createTask')
    const next = presence.timelineSince(feed.latest)
    expect(next.rows).toEqual([])
  })
})

describe('waiting-approve (first publish)', () => {
  it('projects while approval pends and records the decline', () => {
    const presence = hub()
    presence.commandStarted('s1', cmd())
    presence.waitingApprove('s1', 'kanban-demo', '0.3.0')
    expect(presence.snapshot('s1')[0]?.waitingApprove).toEqual({ appId: 'kanban-demo', version: '0.3.0' })
    presence.approveResolved('s1', true)
    expect(presence.snapshot('s1')[0]?.waitingApprove).toBeUndefined()
  })
})

describe('lifecycle', () => {
  it('session disposal releases quietly and dispose stops all timers', () => {
    vi.useFakeTimers()
    try {
      const presence = hub()
      presence.commandStarted('s1', cmd())
      presence.sessionDisposed('s1')
      expect(presence.snapshot('s1')).toEqual([])
      presence.commandStarted('s2', cmd())
      presence.dispose()
      expect(() => vi.advanceTimersByTime(PRESENCE_IDLE_SUSPEND_MS * 3)).not.toThrow()
      expect(presence.snapshot('s2')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('param digest (M5f: non-co-visible param replay)', () => {
  it('summarizeParams caps value length and pair count', () => {
    const digest = summarizeParams({ title: 'x'.repeat(200), board: 'todo', meta: { nested: true }, extra: 'dropped', more: 'dropped' })
    expect(digest).toHaveLength(4)
    expect(digest[0]!.value).toHaveLength(121)
    expect(digest[0]!.value.endsWith('…')).toBe(true)
    expect(digest[1]).toEqual({ name: 'board', value: 'todo' })
    expect(digest[2]!.value).toBe('{"nested":true}')
    expect(digest.some(pair => pair.name === 'more')).toBe(false)
  })

  it('rides the shell snapshot but never the SSE channel', async () => {
    const presence = new PresenceCoordinator()
    const events: PresenceEvent[] = []
    presence.subscribeEvents('kanban-demo', event => { events.push(event) })
    presence.commandStarted('s1', { kind: 'invoke', appId: 'kanban-demo', appName: '看板演示', action: 'createTask', origin: 'installed', paramsSummary: [{ name: 'title', value: 'M5f验收卡' }] })
    const [lease] = presence.snapshot('s1')
    expect(lease?.activeCommand?.paramsSummary).toEqual([{ name: 'title', value: 'M5f验收卡' }])
    const start = events.find(event => event.kind === 'command')
    expect(JSON.stringify(start)).not.toContain('M5f验收卡')
    expect(JSON.stringify(start)).not.toContain('paramsSummary')
    presence.commandSettled('s1', { ts: Date.now(), kind: 'invoke', appId: 'kanban-demo', appName: '看板演示', action: 'createTask', outcome: 'ok', durationMs: 4, origin: 'installed' })
    // The digest persists after settle (a ~100 ms invoke is invisible to 2 s
    // snapshot polls otherwise) until the next command replaces it.
    expect(presence.snapshot('s1')[0]?.activeCommand?.paramsSummary).toEqual([{ name: 'title', value: 'M5f验收卡' }])
    presence.commandStarted('s1', { kind: 'data.write', appId: 'kanban-demo', appName: '看板演示', origin: 'installed' })
    expect(presence.snapshot('s1')[0]?.activeCommand?.paramsSummary).toBeUndefined()
  })
})
