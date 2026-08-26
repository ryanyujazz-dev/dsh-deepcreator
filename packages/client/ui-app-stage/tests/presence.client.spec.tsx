/**
 * Client presence tests (Px-β): render-state derivation from authoritative
 * snapshots (acting / taking-over / waiting-approve / waiting-user, idle
 * degrade, expiry window, banner exit hysteresis) and the feed's poll
 * discipline (poke-driven, keepalive only while live, summary fetch on the
 * handing-back terminal, user controls re-polling).
 * @module @ryanyujazz/dsh-client-ui-app-stage/tests/presence.client.spec
 */
import { describe, expect, it, vi } from 'vitest'
import { BANNER_HYSTERESIS_MS, createPresenceFeed, deriveProjection, type PresenceProjection } from '../src/client/presence.ts'
import type { PresenceLeaseSnapshot } from '@ryanyujazz/dsh-app-stage/types'

const T0 = 1_700_000_000_000

const lease = (over: Partial<PresenceLeaseSnapshot> = {}): PresenceLeaseSnapshot => ({
  leaseId: 'pl-1',
  kind: 'micro',
  state: 'active',
  delegated: false,
  startedAt: T0,
  lastCommandAt: T0,
  apps: [{ appId: 'kanban-demo', name: '看板演示' }],
  focus: { appId: 'kanban-demo', name: '看板演示' },
  ...over,
})

const hidden: PresenceProjection = { state: 'hidden', lease: undefined, idle: false, expiring: false, elapsedMs: 0, remainingMs: undefined, summary: undefined, tick: 0 }

describe('deriveProjection (render states)', () => {
  it('micro active derives acting with elapsed time', () => {
    const p = deriveProjection(lease(), T0 + 5_000, hidden)
    expect(p.state).toBe('acting')
    expect(p.idle).toBe(false)
    expect(p.elapsedMs).toBe(5_000)
  })

  it('a fresh macro lease derives taking-over (the slide-in window)', () => {
    const p = deriveProjection(lease({ kind: 'macro' }), T0 + 1_000, hidden)
    expect(p.state).toBe('taking-over')
  })

  it('macro past the entry window settles to acting', () => {
    const p = deriveProjection(lease({ kind: 'macro' }), T0 + 10_000, hidden)
    expect(p.state).toBe('acting')
  })

  it('waitingApprove outranks everything (first-publish approval)', () => {
    const p = deriveProjection(lease({ waitingApprove: { appId: 'kanban-demo', version: '0.3.0' } }), T0 + 1_000, hidden)
    expect(p.state).toBe('waiting-approve')
  })

  it('suspended-user derives waiting-user', () => {
    const p = deriveProjection(lease({ state: 'suspended-user' }), T0 + 1_000, hidden)
    expect(p.state).toBe('waiting-user')
  })

  it('60 s of silence derives the idle degrade even while formally active', () => {
    const p = deriveProjection(lease(), T0 + 60_500, hidden)
    expect(p.idle).toBe(true)
    expect(p.state).toBe('acting')
  })

  it('macro inside the last 30 s flags expiring with a remaining readout', () => {
    const p = deriveProjection(lease({ kind: 'macro', expiresAt: T0 + 20_000 }), T0 + 1_000, hidden)
    expect(p.expiring).toBe(true)
    expect(p.remainingMs).toBe(19_000)
  })

  it('banner exit hysteresis: a vanished lease stays visible inside 2 s', () => {
    const before = deriveProjection(lease(), T0 + 1_000, hidden)
    const after = deriveProjection(undefined, T0 + 1_500, before)
    expect(after.state).toBe('acting')
    const later = deriveProjection(undefined, T0 + 1_000 + BANNER_HYSTERESIS_MS + 100, before)
    expect(later.state).toBe('hidden')
  })

  it('hysteresis never resurrects a user-held pause', () => {
    const paused = deriveProjection(lease({ state: 'suspended-user' }), T0 + 1_000, hidden)
    const after = deriveProjection(undefined, T0 + 1_500, paused)
    expect(after.state).toBe('hidden')
  })
})

describe('createPresenceFeed (poll discipline)', () => {
  const remote = (leases: PresenceLeaseSnapshot[][]) => {
    let call = 0
    return {
      presenceSnapshot: vi.fn(async () => ({ ok: true, value: { ok: true, leases: leases[Math.min(call++, leases.length - 1)] ?? [] } })),
      presenceControl: vi.fn(async () => ({ ok: true, value: { ok: true, applied: true } })),
      presenceSummary: vi.fn(async () => ({ ok: true, value: { ok: true, summary: { leaseId: 'pl-1', kind: 'micro', startedAt: T0, endedAt: T0 + 90_000, counts: { invoke: 2 }, apps: [{ appId: 'kanban-demo', name: '看板演示' }], keyChanges: [{ appId: 'kanban-demo', path: 'board.items', rev: 3 }], unfulfilled: [], sourceSession: 's-1', actionCount: 2 } } })),
    }
  }
  const session = (): 's-1' | undefined => 's-1'

  it('polls on subscribe and projects the lease', async () => {
    const face = remote([[lease()]])
    const feed = createPresenceFeed({ remote: face, session, now: () => T0 })
    const seen = feed.getSnapshot()
    feed.subscribe(() => {}) // triggers the first poll
    await vi.waitFor(() => { expect(feed.getSnapshot().state).not.toBe(seen.state) })
    expect(feed.getSnapshot().lease?.leaseId).toBe('pl-1')
    feed.dispose()
  })

  it('fetches the summary exactly once when a seen lease vanishes', async () => {
    const face = remote([[lease()], []])
    const feed = createPresenceFeed({ remote: face, session, now: () => T0 + 1_000 })
    feed.subscribe(() => {})
    await vi.waitFor(() => { expect(feed.getSnapshot().lease?.leaseId).toBe('pl-1') })
    feed.poke()
    await vi.waitFor(() => { expect(feed.getSnapshot().summary?.leaseId).toBe('pl-1') })
    expect(face.presenceSummary).toHaveBeenCalledTimes(1)
    expect(feed.getSnapshot().summary?.counts.invoke).toBe(2)
    feed.dismissSummary()
    expect(feed.getSnapshot().summary).toBeUndefined()
    feed.dispose()
  })

  it('a control op applies remotely then re-polls', async () => {
    const face = remote([[lease({ state: 'suspended-user' })]])
    const feed = createPresenceFeed({ remote: face, session, now: () => T0 })
    feed.subscribe(() => {})
    await vi.waitFor(() => { expect(feed.getSnapshot().state).toBe('waiting-user') })
    await feed.control('resume')
    expect(face.presenceControl).toHaveBeenCalledWith('s-1', 'resume')
    feed.dispose()
  })

  it('stays hidden without a lease and never fetches a summary', async () => {
    const face = remote([[]])
    const feed = createPresenceFeed({ remote: face, session, now: () => T0 })
    feed.subscribe(() => {})
    await vi.waitFor(() => { expect(face.presenceSnapshot).toHaveBeenCalled() })
    expect(face.presenceSummary).not.toHaveBeenCalled()
    expect(feed.getSnapshot().state).toBe('hidden')
    feed.dispose()
  })
})

