/**
 * The Presence coordinator — the authoritative lease state machine (Px-β).
 *
 * Every agent command that touches an app flows through here twice: once on
 * start (the lease lights immediately — "首动作必须快亮") and once on
 * settlement (the action ledger that later folds into the summary card and
 * the activity timeline). Leases are authoritative host state; the client
 * shell only projects them (taking-over / acting / waiting-approve /
 * waiting-user / handing-back are render states derived from snapshots).
 *
 * Dual-layer model (presence doc §2.1):
 * - micro: any command-stream action opens it; no duration cap, only an
 *   activity timeout — 60 s of silence suspends and releases it with a
 *   summary. Coarse banner only, never the full particle border.
 * - macro: explicit takeover lights the full particle state with a budget
 *   (AI-self 5 min, user-delegated 15 min). Renewal requires a new command
 *   and re-arms the budget — silence never extends a lease.
 *
 * User input interrupts (lease-level, X1): suspended-user holds until the
 * user explicitly resumes; the agent cannot claw the lease back. Macro
 * expiry and handback release through the same path and emit the summary
 * card material: duration, action counts, apps, the complete AppData key
 * change list, the interrupt fact, versions — the "看 A 改 B" defense.
 * @module @ryanyujazz/dsh-app-stage/presence
 */

/** Silence that suspends an active lease (activity timeout, §2.1). */
export const PRESENCE_IDLE_SUSPEND_MS = 60_000

/** Macro budget for an AI-self takeover (§2.1, explicit tunable). */
export const PRESENCE_MACRO_AI_BUDGET_MS = 5 * 60_000

/** Macro budget for a user-delegated takeover (§2.1, explicit tunable). */
export const PRESENCE_MACRO_DELEGATED_BUDGET_MS = 15 * 60_000

/** Banner exit hysteresis (§2.1): a fresh command within this gap must not
 * let the coarse banner flicker. The projection consumes the constant; the
 * lease itself simply re-arms on every command. */
export const PRESENCE_BANNER_HYSTERESIS_MS = 2_000

/** Ledger caps: a lease longer than this folds into "…and N more" instead. */
export const PRESENCE_ACTIONS_CAP = 500

/** Timeline ring cap (installed-origin actions, most recent kept). */
export const PRESENCE_TIMELINE_CAP = 500

/** Emitted summaries kept for late fetches (per coordinator). */
export const PRESENCE_SUMMARIES_CAP = 50

/** SSE event ring cap (late subscribers replay the recent window). */
export const PRESENCE_EVENTS_CAP = 100

/**
 * One app-layer presence event (the injected runtime's sole input). The
 * payload carries structured fields only — app ids, manifest-declared
 * action names, states, timings — never free app text (the §3.8 discipline
 * applied to the wire). The stream is strictly one-way: the runtime has no
 * callable API, and nothing a page does can produce or alter these events.
 */
export interface PresenceEvent {
  readonly seq: number
  readonly appId: string
  readonly kind: 'lease' | 'command'
  readonly ts: number
  readonly payload: Readonly<Record<string, string | number | boolean>>
}

/** The authoritative lease state (§2.2); host stores no render state. */
export type PresenceLeaseState = 'active' | 'suspended-idle' | 'suspended-user' | 'releasing'

/** Command-stream kinds the ledger counts (§3.6 summary counting). */
export type PresenceCommandKind = 'invoke' | 'data.write' | 'asset.write' | 'publish' | 'open' | 'browser_act'

/** One settled action in the ledger (deterministic-fold material). */
export interface PresenceActionRecord {
  readonly ts: number
  readonly kind: PresenceCommandKind
  readonly appId: string
  readonly appName: string
  readonly version?: string
  readonly action?: string
  readonly outcome: 'ok' | 'error' | 'timeout' | 'declined'
  readonly durationMs: number
  readonly causeId?: string
  /** AppData key paths this command verifiably changed (journal-correlated). */
  readonly keys?: readonly string[]
  /** Timeline feed origin filter: installed actions aggregate globally,
   * dev-origin inner-loop actions never reach the global feed (§3.6). */
  readonly origin: 'installed' | 'dev'
}

/** A lease snapshot for client projection (all render states derive). */
export interface PresenceLeaseSnapshot {
  readonly leaseId: string
  readonly kind: 'micro' | 'macro'
  readonly state: PresenceLeaseState
  /** macro only: user-delegated (vs AI-self) — the wording split (§2.3). */
  readonly delegated: boolean
  readonly startedAt: number
  readonly lastCommandAt: number
  /** macro only: budget deadline (re-armed per command). */
  readonly expiresAt?: number
  /** The current app focus (multi-app leases keep the roster below). */
  readonly focus?: { readonly appId: string; readonly name: string; readonly version?: string }
  readonly apps: readonly { readonly appId: string; readonly name: string; readonly version?: string }[]
  /** First-publish approval pending (waiting-approve render state). */
  readonly waitingApprove?: { readonly appId: string; readonly version: string }
  /** The in-flight command digest (param replay form, non-co-visible). */
  readonly activeCommand?: { readonly kind: PresenceCommandKind; readonly action?: string; readonly paramsSummary?: readonly PresenceParamSummary[] }
}

/** The summary card material (§3.6): a deterministic fold of one lease. */
export interface PresenceSummary {
  readonly leaseId: string
  readonly kind: 'micro' | 'macro'
  readonly startedAt: number
  readonly endedAt: number
  readonly counts: { readonly [K in PresenceCommandKind]?: number }
  readonly apps: readonly { readonly appId: string; readonly name: string; readonly version?: string }[]
  /** Every AppData key-level change during the lease (the anti-cover list). */
  readonly keyChanges: readonly { readonly appId: string; readonly path: string; readonly rev: number }[]
  /** The user-interrupt fact, when one happened (transparent symmetry). */
  readonly userInterrupt?: { readonly at: number; readonly actionsBefore: number }
  /** Actions whose manifest-declared persist produced no change (§3.6). */
  readonly unfulfilled: readonly { readonly appId: string; readonly action: string }[]
  readonly sourceSession: string
  readonly actionCount: number
}

/** One timeline row (installed origin only; the shell's activity view). */
export interface PresenceTimelineRow {
  readonly ts: number
  readonly seq: number
  readonly appId: string
  readonly appName: string
  readonly version?: string
  readonly kind: PresenceCommandKind
  readonly action?: string
  readonly outcome: PresenceActionRecord['outcome']
  readonly durationMs: number
}

/** The face the service and the agent tools talk to. */
export interface PresenceCommandStart {
  readonly kind: PresenceCommandKind
  readonly appId: string
  readonly appName: string
  readonly version?: string
  readonly action?: string
  readonly causeId?: string
  readonly origin?: 'installed' | 'dev'
  /**
   * Structured parameter digest for the non-co-visible param replay form
   * (presence §3.2 X7): names and host-truncated values from the下行 params
   * only. Never emitted on the app-layer SSE channel — free text never
   * enters it; this rides the shell's authoritative snapshot instead.
   */
  readonly paramsSummary?: readonly PresenceParamSummary[]
}

/** One parameter pair in a command's structured digest (host-truncated). */
export interface PresenceParamSummary {
  readonly name: string
  readonly value: string
}

/** Host-side param digest caps: per-value length and pair count. */
const PRESENCE_PARAM_VALUE_MAX = 120
const PRESENCE_PARAM_PAIRS_MAX = 4

/**
 * Build the structured param digest from invoke params (下行 params only —
 * never DOM reads). Values render as JSON for composites, plain text for
 * strings; every value is capped and pairs beyond the cap are dropped.
 */
export function summarizeParams(params: Readonly<Record<string, unknown>>): readonly PresenceParamSummary[] {
  const out: PresenceParamSummary[] = []
  for (const [name, value] of Object.entries(params)) {
    if (out.length >= PRESENCE_PARAM_PAIRS_MAX) break
    const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
    out.push({ name, value: raw.length > PRESENCE_PARAM_VALUE_MAX ? `${raw.slice(0, PRESENCE_PARAM_VALUE_MAX)}…` : raw })
  }
  return out
}

interface Lease {
  /** The in-flight command's digest (params ride the shell snapshot, not SSE). */
  activeCommand?: { readonly kind: PresenceCommandKind; readonly action?: string; readonly paramsSummary?: readonly PresenceParamSummary[] } | undefined
  readonly leaseId: string
  readonly sessionId: string
  kind: 'micro' | 'macro'
  state: PresenceLeaseState
  delegated: boolean
  startedAt: number
  lastCommandAt: number
  expiresAt?: number | undefined
  focus?: { appId: string; name: string; version?: string } | undefined
  readonly apps: Map<string, { name: string; version?: string }>
  waitingApprove?: { appId: string; version: string } | undefined
  readonly actions: PresenceActionRecord[]
  readonly keyChanges: { appId: string; path: string; rev: number }[]
  userInterrupt?: { at: number; actionsBefore: number } | undefined
  /** Actions that declared persist but produced no key change yet. */
  readonly pendingPersist: { appId: string; action: string; causeId?: string; ts: number }[]
  idleTimer?: ReturnType<typeof setTimeout> | undefined
  expiryTimer?: ReturnType<typeof setTimeout> | undefined
}

/**
 * Per-host coordinator. One lease per session (the command stream is the
 * agent's session); a macro takeover replaces the session's micro lease
 * without dropping the ledger — the summary covers the whole run.
 */
export class PresenceCoordinator {
  private readonly leases = new Map<string, Lease>() // key: sessionId
  private readonly summaries = new Map<string, PresenceSummary>()
  private readonly timeline: PresenceTimelineRow[] = []
  private seq = 0
  private disposed = false
  private eventSeq = 0
  private readonly events: PresenceEvent[] = []
  private readonly eventListeners = new Set<{ appId: string | undefined; listener: (event: PresenceEvent) => void }>()

  /** Snapshot every live lease for one session (the shell's projection feed). */
  snapshot(sessionId: string): PresenceLeaseSnapshot[] {
    const lease = this.leases.get(sessionId)
    return lease === undefined ? [] : [this.project(lease)]
  }

  /** The timeline feed for the activity view (installed origin, §3.6). */
  timelineSince(sinceSeq: number): { rows: PresenceTimelineRow[]; latest: number } {
    const rows = this.timeline.filter(row => row.seq > sinceSeq)
    return { rows, latest: this.seq }
  }

  /** A previously emitted summary (late fetch by lease id). */
  summary(leaseId: string): PresenceSummary | undefined {
    return this.summaries.get(leaseId)
  }

  /** Subscribe to the app-layer event stream (SSE consumers). */
  subscribeEvents(appId: string | undefined, listener: (event: PresenceEvent) => void): () => void {
    const entry = { appId, listener }
    this.eventListeners.add(entry)
    return () => { this.eventListeners.delete(entry) }
  }

  /** The recent event window (connect-time replay; seq-deduped client-side). */
  recentEvents(appId?: string): readonly PresenceEvent[] {
    return this.events.filter(event => appId === undefined || event.appId === appId)
  }

  /** Command start: open/renew the lease and refocus — the fast light. */
  commandStarted(sessionId: string, start: PresenceCommandStart): string | undefined {
    if (this.disposed) return undefined
    let lease = this.leases.get(sessionId)
    if (lease === undefined) lease = this.openMicro(sessionId, start)
    // A user-interrupted lease records but stays suspended (X1: no clawback).
    lease.lastCommandAt = Date.now()
    lease.focus = { appId: start.appId, name: start.appName, ...(start.version !== undefined ? { version: start.version } : {}) }
    lease.activeCommand = { kind: start.kind, ...(start.action !== undefined ? { action: start.action } : {}), ...(start.paramsSummary !== undefined && start.paramsSummary.length > 0 ? { paramsSummary: start.paramsSummary } : {}) }
    // SSE keeps its no-free-text discipline: the param digest rides the
    // shell's snapshot remote only, never the app-layer channel.
    this.emit(start.appId, 'command', { phase: 'start', commandKind: start.kind, ...(start.action !== undefined ? { action: start.action } : {}) })
    this.roster(lease, start)
    if (lease.kind === 'macro') {
      // Renewal requires a new command and re-arms the budget (§2.1).
      const budget = lease.delegated ? PRESENCE_MACRO_DELEGATED_BUDGET_MS : PRESENCE_MACRO_AI_BUDGET_MS
      lease.expiresAt = lease.lastCommandAt + budget
      this.armExpiry(lease)
    }
    if (lease.state === 'suspended-idle') lease.state = 'active'
    this.armIdle(lease)
    return lease.leaseId
  }

  /** Command settlement: append the ledger row and the timeline entry. */
  commandSettled(sessionId: string, record: PresenceActionRecord): void {
    if (this.disposed) return
    this.emit(record.appId, 'command', { phase: 'settled', commandKind: record.kind, outcome: record.outcome, ...(record.action !== undefined ? { action: record.action } : {}) })
    const lease = this.leases.get(sessionId)
    if (lease !== undefined) {
      // The digest persists after settle (replaced by the next command, gone
      // with the lease): a ~100 ms invoke is invisible to the shell's 2 s
      // snapshot polls if the digest only exists in flight — the param
      // summary would never be seen. It is the LAST command's digest, a
      // fact, not a claim about what is running now.
      if (lease.actions.length < PRESENCE_ACTIONS_CAP) lease.actions.push(record)
      this.roster(lease, record)
      if (record.action !== undefined && (record.keys === undefined || record.keys.length === 0) && record.kind === 'invoke' && record.outcome === 'ok') {
        lease.pendingPersist.push({ appId: record.appId, action: record.action, ...(record.causeId !== undefined ? { causeId: record.causeId } : {}), ts: record.ts })
      } else if (record.keys !== undefined && record.keys.length > 0) {
        // Any later change satisfies earlier pending-persist declarations of
        // the same app (the journal attributes per write, not per action).
        const stillPending = lease.pendingPersist.filter(pending => pending.appId !== record.appId)
        lease.pendingPersist.length = 0
        for (const pending of stillPending) lease.pendingPersist.push(pending)
      }
    }
    if ((record.origin ?? 'installed') === 'installed') {
      this.seq += 1
      this.timeline.push({
        ts: record.ts, seq: this.seq, appId: record.appId, appName: record.appName,
        ...(record.version !== undefined ? { version: record.version } : {}),
        kind: record.kind, ...(record.action !== undefined ? { action: record.action } : {}),
        outcome: record.outcome, durationMs: record.durationMs,
      })
      if (this.timeline.length > PRESENCE_TIMELINE_CAP) this.timeline.splice(0, this.timeline.length - PRESENCE_TIMELINE_CAP)
    }
  }

  /** An AppData write landed for a leased app: the anti-cover change list. */
  noteKeyChange(sessionId: string, appId: string, path: string, rev: number): void {
    const lease = this.leases.get(sessionId)
    if (lease === undefined) return
    if (!lease.apps.has(appId)) return
    lease.keyChanges.push({ appId, path, rev })
  }

  /** Explicit takeover (macro): lights the full particle state with a budget. */
  takeover(sessionId: string, app: { appId: string; name: string; version?: string }, delegated: boolean): PresenceLeaseSnapshot {
    if (this.disposed) throw new Error('presence coordinator is disposed')
    const existing = this.leases.get(sessionId)
    const now = Date.now()
    const budget = delegated ? PRESENCE_MACRO_DELEGATED_BUDGET_MS : PRESENCE_MACRO_AI_BUDGET_MS
    let lease: Lease
    if (existing === undefined) {
      lease = this.openMicro(sessionId, { kind: 'open', appId: app.appId, appName: app.name, ...(app.version !== undefined ? { version: app.version } : {}) })
    } else {
      lease = existing
    }
    lease.kind = 'macro'
    lease.delegated = delegated
    this.emit(app.appId, 'lease', { phase: 'active', leaseKind: 'macro', delegated })
    lease.startedAt = now
    lease.lastCommandAt = now
    lease.expiresAt = now + budget
    lease.state = 'active'
    lease.focus = { appId: app.appId, name: app.name, ...(app.version !== undefined ? { version: app.version } : {}) }
    this.roster(lease, { appId: app.appId, appName: app.name, ...(app.version !== undefined ? { version: app.version } : {}) })
    this.armIdle(lease)
    this.armExpiry(lease)
    return this.project(lease)
  }

  /** User input: lease-level interrupt (X1) — the agent cannot claw back. */
  interrupt(sessionId: string): boolean {
    const lease = this.leases.get(sessionId)
    if (lease === undefined || lease.state === 'releasing') return false
    if (lease.state === 'suspended-user') return true
    lease.userInterrupt = { at: Date.now(), actionsBefore: lease.actions.length }
    lease.state = 'suspended-user'
    this.emit(this.focusApp(lease), 'lease', { phase: 'suspended-user', leaseKind: lease.kind })
    lease.waitingApprove = undefined
    this.armIdle(lease) // silence still suspends-and-releases underneath
    return true
  }

  /** User resumes a suspended-user lease (explicit "continue" only). */
  resume(sessionId: string): boolean {
    const lease = this.leases.get(sessionId)
    if (lease === undefined || lease.state !== 'suspended-user') return false
    lease.state = 'active'
    lease.lastCommandAt = Date.now()
    this.emit(this.focusApp(lease), 'lease', { phase: 'active', leaseKind: lease.kind })
    if (lease.kind === 'macro') {
      const budget = lease.delegated ? PRESENCE_MACRO_DELEGATED_BUDGET_MS : PRESENCE_MACRO_AI_BUDGET_MS
      lease.expiresAt = lease.lastCommandAt + budget
      this.armExpiry(lease)
    }
    this.armIdle(lease)
    return true
  }

  /** User handback ("收回"): release now with the summary card. */
  handback(sessionId: string): boolean {
    const lease = this.leases.get(sessionId)
    if (lease === undefined || lease.state === 'releasing') return false
    this.release(lease)
    return true
  }

  /** First-publish approval pending (waiting-approve render state). */
  waitingApprove(sessionId: string, appId: string, version: string): void {
    const lease = this.leases.get(sessionId)
    if (lease === undefined) return
    lease.waitingApprove = { appId, version }
  }

  /** The approval resolved: approve keeps acting, decline records it. */
  approveResolved(sessionId: string, declined: boolean): void {
    const lease = this.leases.get(sessionId)
    if (lease === undefined) return
    lease.waitingApprove = undefined
    if (declined) {
      const focus = lease.focus
      if (focus !== undefined) {
        if (lease.actions.length < PRESENCE_ACTIONS_CAP) {
          lease.actions.push({ ts: Date.now(), kind: 'publish', appId: focus.appId, appName: focus.name, outcome: 'declined', durationMs: 0, origin: 'installed' })
        }
      }
    }
  }

  /** Session disposal: release quietly (no summary fetcher is coming). */
  sessionDisposed(sessionId: string): void {
    const lease = this.leases.get(sessionId)
    if (lease !== undefined) this.release(lease, { keepSummary: false })
  }

  /** Stop all timers and drop state (row unload). */
  dispose(): void {
    this.disposed = true
    for (const lease of this.leases.values()) {
      if (lease.idleTimer !== undefined) clearTimeout(lease.idleTimer)
      if (lease.expiryTimer !== undefined) clearTimeout(lease.expiryTimer)
    }
    this.leases.clear()
    this.events.length = 0
    this.eventListeners.clear()
  }

  // -----------------------------------------------------------------------

  /** Publish one app-layer event (ring-buffered + fan-out; structured only). */
  private emit(appId: string, kind: PresenceEvent['kind'], payload: Readonly<Record<string, string | number | boolean>>): void {
    if (this.disposed) return
    this.eventSeq += 1
    const event: PresenceEvent = { seq: this.eventSeq, appId, kind, ts: Date.now(), payload }
    this.events.push(event)
    if (this.events.length > PRESENCE_EVENTS_CAP) this.events.splice(0, this.events.length - PRESENCE_EVENTS_CAP)
    for (const entry of this.eventListeners) {
      if (entry.appId === undefined || entry.appId === appId) entry.listener(event)
    }
  }

  private focusApp(lease: Lease): string {
    return lease.focus?.appId ?? lease.apps.keys().next().value ?? ''
  }

  private openMicro(sessionId: string, start: PresenceCommandStart): Lease {
    const lease: Lease = {
      leaseId: `pl${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      sessionId,
      kind: 'micro',
      state: 'active',
      delegated: false,
      startedAt: Date.now(),
      lastCommandAt: Date.now(),
      apps: new Map(),
      actions: [],
      keyChanges: [],
      pendingPersist: [],
    }
    this.leases.set(sessionId, lease)
    this.roster(lease, start)
    return lease
  }

  private roster(lease: Lease, app: { appId: string; appName: string; version?: string }): void {
    const known = lease.apps.get(app.appId)
    if (known === undefined) lease.apps.set(app.appId, { name: app.appName, ...(app.version !== undefined ? { version: app.version } : {}) })
    else if (app.version !== undefined && known.version !== app.version) lease.apps.set(app.appId, { name: app.appName, version: app.version })
  }

  private armIdle(lease: Lease): void {
    if (lease.idleTimer !== undefined) clearTimeout(lease.idleTimer)
    lease.idleTimer = setTimeout(() => {
      lease.idleTimer = undefined
      if (this.disposed || lease.state === 'releasing') return
      lease.state = 'suspended-idle'
      if (lease.kind === 'micro') {
        // Micro leases release on idle (the summary is the release artifact).
        this.release(lease)
      }
      // Macro: the expiry timer (armExpiry) solely owns the deadline —
      // arming another here would orphan the previous one (it fires at the
      // pre-renewal deadline and releases a renewed lease: seen on the real
      // GUI as an 8-second macro "expiry"). Past-due is the only release
      // this path takes.
      else if (lease.expiresAt !== undefined && lease.expiresAt - Date.now() <= 0) {
        this.release(lease)
      }
    }, PRESENCE_IDLE_SUSPEND_MS)
  }

  private armExpiry(lease: Lease): void {
    if (lease.expiryTimer !== undefined) clearTimeout(lease.expiryTimer)
    if (lease.expiresAt === undefined) return
    const delay = Math.max(0, lease.expiresAt - Date.now())
    lease.expiryTimer = setTimeout(() => {
      lease.expiryTimer = undefined
      if (this.disposed || lease.state === 'releasing') return
      this.release(lease)
    }, delay)
  }

  private release(lease: Lease, options: { keepSummary?: boolean } = {}): void {
    const keepSummary = options.keepSummary !== false
    if (lease.idleTimer !== undefined) clearTimeout(lease.idleTimer)
    if (lease.expiryTimer !== undefined) clearTimeout(lease.expiryTimer)
    lease.state = 'releasing'
    this.emit(this.focusApp(lease), 'lease', { phase: 'released', leaseKind: lease.kind })
    const summary = this.fold(lease)
    if (keepSummary) {
      this.summaries.set(summary.leaseId, summary)
      if (this.summaries.size > PRESENCE_SUMMARIES_CAP) {
        const oldest = this.summaries.keys().next().value
        if (oldest !== undefined) this.summaries.delete(oldest)
      }
    }
    this.leases.delete(lease.sessionId)
  }

  /** The deterministic fold (§3.6): official-log action records + the
   * journal-correlated key change list, truncation-tolerant. */
  private fold(lease: Lease): PresenceSummary {
    const counts: { [K in PresenceCommandKind]?: number } = {}
    for (const action of lease.actions) counts[action.kind] = (counts[action.kind] ?? 0) + 1
    const apps = [...lease.apps.entries()].map(([appId, info]) => ({ appId, name: info.name, ...(info.version !== undefined ? { version: info.version } : {}) }))
    const pending = lease.pendingPersist.slice(-8).map(pending => ({ appId: pending.appId, action: pending.action }))
    return {
      leaseId: lease.leaseId,
      kind: lease.kind,
      startedAt: lease.startedAt,
      endedAt: Date.now(),
      counts,
      apps,
      keyChanges: lease.keyChanges.slice(-PRESENCE_ACTIONS_CAP),
      ...(lease.userInterrupt !== undefined ? { userInterrupt: lease.userInterrupt } : {}),
      unfulfilled: pending,
      sourceSession: lease.sessionId,
      actionCount: lease.actions.length,
    }
  }

  private project(lease: Lease): PresenceLeaseSnapshot {
    return {
      leaseId: lease.leaseId,
      kind: lease.kind,
      state: lease.state,
      delegated: lease.delegated,
      startedAt: lease.startedAt,
      lastCommandAt: lease.lastCommandAt,
      ...(lease.expiresAt !== undefined ? { expiresAt: lease.expiresAt } : {}),
      ...(lease.focus !== undefined ? { focus: lease.focus } : {}),
      apps: [...lease.apps.entries()].map(([appId, info]) => ({ appId, name: info.name, ...(info.version !== undefined ? { version: info.version } : {}) })),
      ...(lease.waitingApprove !== undefined ? { waitingApprove: lease.waitingApprove } : {}),
      ...(lease.activeCommand !== undefined ? { activeCommand: lease.activeCommand } : {}),
    }
  }
}
