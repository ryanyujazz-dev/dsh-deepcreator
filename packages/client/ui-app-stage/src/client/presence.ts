/**
 * The presence projection feed (Px-β client half): polls authoritative
 * lease snapshots and derives every render state locally.
 *
 * Poll discipline (host calls are never free): no polling while no lease
 * exists — the router's activity signal pokes the feed when a command
 * flows, and a 2 s keepalive runs only while at least one lease is live or
 * the exit hysteresis window is open. Everything the banner renders between
 * polls (idle countdown, budget expiry, banner exit hysteresis) is derived
 * from the last snapshot fields against a local 1 s tick, so wire traffic
 * stays proportional to actual agent activity.
 *
 * Render states (presence doc §2.2) — taking-over / acting /
 * waiting-approve / waiting-user — plus the handing-back terminal: a lease
 * that disappears from the snapshot while previously seen fetches its
 * summary card (the deterministic fold) exactly once.
 * @module @ryanyujazz/dsh-client-ui-app-stage/client/presence
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PresenceLeaseSnapshot, PresenceSummary } from '@ryanyujazz/dsh-app-stage/types'
import type { AppStageRemote } from './contract.ts'

/** Idle silence that degrades an active lease's visuals (§2.1). */
const IDLE_SUSPEND_MS = 60_000

/** Banner exit hysteresis: the coarse banner must not flicker (§2.1). */
export const BANNER_HYSTERESIS_MS = 2_000

/** Keepalive poll while any lease is live (authoritative transitions). */
const KEEPALIVE_MS = 2_000

/** Local tick for countdowns and derived-state refresh. */
const TICK_MS = 1_000

/** Every render state the banner/border/chip can show. */
export type PresenceRenderState =
  | 'hidden'
  | 'acting'
  | 'taking-over'
  | 'waiting-approve'
  | 'waiting-user'

/** The projection the shell renders (one lease per session by design). */
export interface PresenceProjection {
  readonly state: PresenceRenderState
  readonly lease: PresenceLeaseSnapshot | undefined
  /** Derived: the lease went idle (visual degrade, countdown release). */
  readonly idle: boolean
  /** Derived: macro budget inside its last 30 s. */
  readonly expiring: boolean
  readonly elapsedMs: number
  readonly remainingMs: number | undefined
  /** A summary card pending display (handing-back terminal). */
  readonly summary: PresenceSummary | undefined
  /** Local tick counter — banner text recomputes when it moves. */
  readonly tick: number
}

const HIDDEN: PresenceProjection = { state: 'hidden', lease: undefined, idle: false, expiring: false, elapsedMs: 0, remainingMs: undefined, summary: undefined, tick: 0 }

/** Derive the render state from one lease snapshot and the wall clock. */
export function deriveProjection(lease: PresenceLeaseSnapshot | undefined, now: number, previous: PresenceProjection): PresenceProjection {
  if (lease === undefined) {
    // Exit hysteresis: keep the last banner up briefly so back-to-back
    // commands do not flicker it (only the visual fades, nothing else).
    const inHysteresis = previous.lease !== undefined
      && previous.state !== 'waiting-user'
      && now - previous.lease.lastCommandAt < BANNER_HYSTERESIS_MS
    if (inHysteresis) return { ...previous, tick: previous.tick + 1 }
    return { ...HIDDEN, summary: previous.summary, tick: previous.tick + 1 }
  }
  const idle = lease.state === 'suspended-idle' || (lease.state === 'active' && now - lease.lastCommandAt >= IDLE_SUSPEND_MS)
  const expiring = lease.expiresAt !== undefined && lease.expiresAt - now <= 30_000 && lease.expiresAt - now > 0
  return {
    state: lease.waitingApprove !== undefined
      ? 'waiting-approve'
      : lease.state === 'suspended-user'
        ? 'waiting-user'
        : lease.kind === 'macro' && previous.lease?.leaseId !== lease.leaseId && now - lease.startedAt < BANNER_HYSTERESIS_MS * 4
          ? 'taking-over'
          : 'acting',
    lease,
    idle,
    expiring,
    elapsedMs: Math.max(0, now - lease.startedAt),
    remainingMs: lease.expiresAt !== undefined ? Math.max(0, lease.expiresAt - now) : undefined,
    summary: previous.summary,
    tick: previous.tick + 1,
  }
}

export interface PresenceFeedApi {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => PresenceProjection
  /** A command is flowing (router activity): poll immediately. */
  poke: () => void
  /** A user control op: apply, then re-poll to confirm the transition. */
  control: (op: 'interrupt' | 'resume' | 'handback') => Promise<void>
  /** Dismiss the summary card. */
  dismissSummary: () => void
  dispose: () => void
}

export interface PresenceFeedEnv {
  readonly remote: Pick<AppStageRemote, 'presenceSnapshot' | 'presenceControl' | 'presenceSummary'>
  readonly session: () => SessionId | undefined
  /** Test seam; default is the wall clock. */
  readonly now?: () => number
}

/**
 * The external store the shell reads through useSyncExternalStore. One feed
 * per shell mount; poking is idempotent (an in-flight poll swallows later
 * pokes until it settles).
 */
export function createPresenceFeed(env: PresenceFeedEnv): PresenceFeedApi {
  const now = env.now ?? ((): number => Date.now())
  let projection: PresenceProjection = HIDDEN
  let lastSeenLeaseId: string | undefined
  const listeners = new Set<() => void>()
  let polling = false
  let disposed = false
  let keepalive: ReturnType<typeof setInterval> | undefined
  let tick: ReturnType<typeof setInterval> | undefined

  const emit = (): void => { for (const listener of listeners) listener() }

  const ensureTimers = (): void => {
    if (keepalive === undefined) keepalive = setInterval(() => { void poll() }, KEEPALIVE_MS)
    if (tick === undefined) tick = setInterval(() => {
      projection = deriveProjection(projection.lease, now(), projection)
      emit()
    }, TICK_MS)
  }

  const idleTimers = (): void => {
    // Keep the tick while a summary card is pending dismissal; otherwise a
    // hidden projection needs no clocks at all.
    if (projection.state === 'hidden' && projection.summary === undefined) {
      if (keepalive !== undefined) { clearInterval(keepalive); keepalive = undefined }
      if (tick !== undefined) { clearInterval(tick); tick = undefined }
    }
  }

  const poll = async (): Promise<void> => {
    const sessionId = env.session()
    if (polling || disposed || sessionId === undefined) return
    polling = true
    try {
      const wire = await env.remote.presenceSnapshot(sessionId)
      if (disposed) return
      if (wire.ok && wire.value.ok) {
        const lease = wire.value.leases[0]
        const idBefore = lastSeenLeaseId
        projection = deriveProjection(lease, now(), projection)
        lastSeenLeaseId = lease?.leaseId
        // Handing-back terminal: a previously seen lease vanished — fetch
        // its summary card exactly once (the host keeps emitted summaries).
        if (idBefore !== undefined && lease === undefined && projection.summary?.leaseId !== idBefore) {
          const summaryWire = await env.remote.presenceSummary(sessionId, idBefore)
          if (summaryWire.ok && summaryWire.value.ok && !disposed) {
            projection = { ...projection, summary: summaryWire.value.summary }
          }
        }
        if (lease !== undefined || projection.state !== 'hidden' || projection.summary !== undefined) ensureTimers()
        idleTimers()
        emit()
      }
    } catch {
      /* silent: the next poke or keepalive retries */
    } finally {
      polling = false
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) void poll()
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => projection,
    poke: () => { void poll() },
    async control(op) {
      const sessionId = env.session()
      if (sessionId === undefined) return
      const wire = await env.remote.presenceControl(sessionId, op)
      if (wire.ok && wire.value.ok) await poll()
    },
    dismissSummary: () => {
      projection = { ...projection, summary: undefined }
      idleTimers()
      emit()
    },
    dispose: () => {
      disposed = true
      if (keepalive !== undefined) clearInterval(keepalive)
      if (tick !== undefined) clearInterval(tick)
      listeners.clear()
    },
  }
}
