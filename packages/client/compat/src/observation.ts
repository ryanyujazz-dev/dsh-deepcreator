// Re-implementation of the fork's 0.1.1 `provideInfoFor` observation lease on
// the official 0.1.2 session-controller primitives (migration Phase 4; the
// old semantics lived in the removed dsh-client-runtime patch). One
// subscription owns one child session's history window WITHOUT changing the
// runtime's current selection: first subscribe retains the observation and
// the direct-parent address and opens the session, last unsubscribe cools it
// (patched `Session.deactivate`) behind a microtask guard that survives
// StrictMode's synchronous unsubscribe/resubscribe, and only sessions pushed
// out of the MRU cooling window lose their eligibility hold (the official
// scope prune may then reclaim them). Deliberately framework-free: the embed
// component subscribes through `useSyncExternalStore`.

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Deactivated (cooled) sessions kept resident before scope reclamation. */
const COLD_RETENTION_LIMIT = 8

/** The session-face subset the lease drives. Both members come from the fork
 * api-session-controller patch; test doubles may carry neither. */
interface ObservedSession {
  /** First open pulls the tail page (idempotent). */
  open?(): Promise<void>
  /** Release the assembled event window, keep scoped presentation state. */
  deactivate?(): void
}

/**
 * The session-controller surface the lease drives. Structural so tests can
 * pass a double; the production `ClientSessions` carries every member via
 * the fork's api-session-controller patch.
 */
export interface ObservationLeaseSessions {
  /** Fork patch: widen scope eligibility for non-navigating leases. */
  retainObservation?(sessionId: SessionId): void
  /** Fork patch: release a lease's eligibility hold. */
  releaseObservation?(sessionId: SessionId): void
  /** Fork patch: retain the direct-parent address without selecting. */
  retainNavigationAddress?(sessionId: SessionId): unknown
  /** Scope-binding lookup; absent ids simply resolve to undefined. */
  binding?(sessionId: SessionId): { session: object } | undefined
}

/** Lease state observed by the embed surface: whether this id is held. */
export interface SessionLeaseSnapshot {
  readonly leased: boolean
}

/** Identity-stable observable for one child session's observation lease. */
export type SessionLease = HostObservable<SessionLeaseSnapshot> & {
  readonly sessionId: SessionId
}

export interface SessionLeaseHub {
  /** The (per-id stable) lease source; subscribing acquires the lease. */
  lease(sessionId: SessionId): SessionLease
}

interface LeaseEntry {
  readonly sessionId: SessionId
  readonly listeners: Set<() => void>
  /** Assigned once during construction (closures need the entry first). */
  source: SessionLease
  /** Monotonic token: a scheduled release only fires while it still wins. */
  releaseToken: number
  snapshot: SessionLeaseSnapshot
}

/** Build the non-navigating observation lease hub over a sessions service. */
export function createSessionLeaseHub(sessions: ObservationLeaseSessions): SessionLeaseHub {
  const entries = new Map<SessionId, LeaseEntry>()
  /** Recently released, deactivated sessions — coldest last. */
  const coldOrder: SessionId[] = []

  const notify = (entry: LeaseEntry): void => {
    for (const listener of [...entry.listeners]) listener()
  }

  // The concrete Session carries open/deactivate; the published SessionFace
  // (ISession & observable) omits both, so the face is recovered locally.
  const observedSession = (sessionId: SessionId): ObservedSession | undefined => {
    const session: unknown = sessions.binding?.(sessionId)?.session
    return (session ?? undefined) as ObservedSession | undefined
  }

  const acquire = (entry: LeaseEntry): void => {
    const { sessionId } = entry
    entry.releaseToken += 1
    const coldIndex = coldOrder.indexOf(sessionId)
    if (coldIndex >= 0) coldOrder.splice(coldIndex, 1)
    // Widen eligibility first so `binding` mints the scope for catalog-only
    // children, then retain the direct-parent address without selecting.
    sessions.retainObservation?.(sessionId)
    sessions.retainNavigationAddress?.(sessionId)
    void observedSession(sessionId)?.open?.()
    entry.snapshot = { leased: true }
    notify(entry)
  }

  const release = (entry: LeaseEntry): void => {
    const { sessionId } = entry
    observedSession(sessionId)?.deactivate?.()
    coldOrder.push(sessionId)
    while (coldOrder.length > COLD_RETENTION_LIMIT) {
      const evicted = coldOrder.shift()
      if (evicted !== undefined) sessions.releaseObservation?.(evicted)
    }
    entry.snapshot = { leased: false }
    notify(entry)
  }

  const scheduleRelease = (entry: LeaseEntry): void => {
    const token = entry.releaseToken + 1
    entry.releaseToken = token
    // StrictMode remounts subscribe within one tick; the token check keeps a
    // synchronous re-acquire from tearing down the window it just reopened.
    queueMicrotask(() => {
      if (entry.releaseToken !== token || entry.listeners.size > 0) return
      release(entry)
    })
  }

  return {
    lease(sessionId) {
      let entry = entries.get(sessionId)
      if (entry === undefined) {
        const created: LeaseEntry = {
          sessionId,
          listeners: new Set(),
          releaseToken: 0,
          snapshot: { leased: false },
          // Assigned right after the literal; the closure reads mutable
          // per-lease state while the source identity itself never moves.
          source: undefined as unknown as SessionLease,
        }
        created.source = {
          sessionId,
          subscribe: (listener: () => void) => {
            created.listeners.add(listener)
            if (created.listeners.size === 1) acquire(created)
            return () => {
              if (!created.listeners.delete(listener)) return
              if (created.listeners.size === 0) scheduleRelease(created)
            }
          },
          getSnapshot: () => created.snapshot,
        }
        entries.set(sessionId, created)
        entry = created
      }
      return entry.source
    },
  }
}
