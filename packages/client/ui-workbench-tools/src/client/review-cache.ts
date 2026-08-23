// ReviewCacheController: one session's Review data plane, alive from session
// entry (before any panel opens) until the session leaves the list. It owns
// status, checks and the parse-once diff caches, warms them through a
// sequential background prefetch, and keeps them fresh from the session's own
// event stream (settled mutation tools, finished turns). The panel is a pure
// view over its snapshot; user gestures (expand, reveal, manual refresh,
// visibility) arrive as method calls.

import type {
  ConversationSnapshot, ObservableSnapshot, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ReviewChecksResult, ReviewDiffResult, ReviewFileSummary, ReviewHistoryResult, ReviewLocation, ReviewManifestResult,
  ReviewPatchFile, ReviewScope, ReviewStatusResult, ReviewSummaryResult, ReviewUndoTurnResult,
} from '@ryanyujazz/dsh-review/types'
import {
  REVIEW_CACHE_BYTES, REVIEW_CACHE_LIMIT, REVIEW_IDLE_PREFETCH_LIMIT, REVIEW_PREFETCH_LIMIT,
  decodeMutationSignal, encodeMutationSignal,
  evictCollapsedCaches, markStale, matchReviewFile, mergeFileEntries, mutationSignal,
  ReviewDiffParser, sameDiffResult, type FileEntries, type FileEntry, type MutationSignal, type ReadyCache,
} from './review-model.ts'

type StatusOk = Extract<ReviewStatusResult, { ok: true }>
type ChecksOk = Extract<ReviewChecksResult, { ok: true }>
type HistoryOk = Extract<ReviewHistoryResult, { ok: true }>
type SummaryOk = Extract<ReviewSummaryResult, { ok: true }>
type ManifestOk = Extract<ReviewManifestResult, { ok: true }>

/** The immutable view the panel renders through useSyncExternalStore. */
export interface ReviewCacheSnapshot {
  status: StatusOk | null
  checks: ChecksOk | null
  history: HistoryOk | null
  summary: SummaryOk | null
  scope: ReviewScope
  /** Workspace-relative POSIX repository path; empty is the root context. */
  repository: string
  entries: Readonly<FileEntries>
  /** Manual-refresh error surface; background failures stay silent. */
  error: string | null
  /** Non-blocking summary/statistics failure; status and file diffs remain usable. */
  warning: string | null
}

export type ReviewMetaSnapshot = Pick<ReviewCacheSnapshot, 'status' | 'checks' | 'summary' | 'scope' | 'repository' | 'error' | 'warning'>
export interface ReviewTotalsSnapshot { added: number; removed: number }

/** A focused refresh must not confuse cancellation or transport failure with a real miss. */
export type ReviewRefreshOutcome =
  | { kind: 'ready' }
  | { kind: 'found'; path: string }
  | { kind: 'missing' }
  | { kind: 'superseded' }
  | { kind: 'error'; message: string }

const EMPTY_SNAPSHOT: ReviewCacheSnapshot = {
  status: null, checks: null, history: null, summary: null, scope: 'uncommitted', repository: '', entries: {}, error: null, warning: null,
}

const EMPTY_META: ReviewMetaSnapshot = {
  status: null, checks: null, summary: null, scope: 'uncommitted', repository: '', error: null, warning: null,
}
const EMPTY_TOTALS: ReviewTotalsSnapshot = { added: 0, removed: 0 }

export type ReviewLoadPriority = 'focus' | 'viewport' | 'overscan' | 'idle'
const PRIORITY_ORDER = ['focus', 'viewport', 'overscan', 'idle'] as const
const PRIORITY_RANK: Record<ReviewLoadPriority, number> = { focus: 0, viewport: 1, overscan: 2, idle: 3 }

/** Settled mutation tools are coalesced into one invalidation after this long. */
const MUTATION_DEBOUNCE_MS = 24
const PROBE_POLL_MS = 2_000
const TURN_END_HISTORY_RETRY_MS = 2_000
const PATCH_BATCH_LIMIT = 16
const DEFERRED_METADATA_MS = 350

function transportError(result: { ok: false; error: { message: string } }): Error {
  return new Error(result.error.message)
}

function sameHistory(left: HistoryOk | null, right: HistoryOk): boolean {
  if (left === null || left.repositoryRoot !== right.repositoryRoot || left.workspaceKind !== right.workspaceKind
    || left.head !== right.head || left.turns.length !== right.turns.length) return false
  return JSON.stringify(left.turns) === JSON.stringify(right.turns)
}

function sameSummary(left: SummaryOk | null, right: SummaryOk): boolean {
  return left !== null
    && left.repositoryRoot === right.repositoryRoot
    && JSON.stringify(left.scope) === JSON.stringify(right.scope)
    && left.location?.repository === right.location?.repository
    && left.additions === right.additions
    && left.deletions === right.deletions
    && JSON.stringify(left.files) === JSON.stringify(right.files)
}

function sameStatusFiles(left: StatusOk | null, right: StatusOk): boolean {
  if (left === null || left.location?.repository !== right.location?.repository || left.files.length !== right.files.length) return false
  return left.files.every((file, index) => {
    const other = right.files[index]
    return other !== undefined && file.path === other.path && file.oldPath === other.oldPath
      && file.kind === other.kind && file.presentation === other.presentation
  })
}

function locationArgument(repository: string): ReviewLocation | undefined {
  return repository === '' ? undefined : { repository }
}

function argumentCountMismatch(value: unknown): boolean {
  const message = value instanceof Error
    ? value.message
    : typeof value === 'object' && value !== null && 'ok' in value && value.ok === false
      && 'error' in value && typeof value.error === 'object' && value.error !== null
      && 'message' in value.error && typeof value.error.message === 'string'
      ? value.error.message
      : String(value)
  return /expected \d+ argument\(s\), got \d+/i.test(message)
}

/**
 * Typert validates Remote arity before invoking the Host method. Optional
 * TypeScript parameters still count toward that wire arity, so a new Host
 * expects the explicit trailing `undefined` while an old Host rejects it.
 * Retry only the root-context call; repository drill-down has no safe legacy
 * equivalent and must never silently fall back to the root repository.
 */
async function rootArityCompatible<T>(current: () => Promise<T>, legacy: () => Promise<T>): Promise<T> {
  try {
    const result = await current()
    return argumentCountMismatch(result) ? await legacy() : result
  } catch (reason) {
    if (argumentCountMismatch(reason)) return await legacy()
    throw reason
  }
}

function missingSummaryMethod(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason)
  return /unknown (remote )?method|method .*summary.*not found|does not exist/i.test(message)
}

function missingRemoteMethod(reason: unknown, method: string): boolean {
  const message = reason instanceof Error ? reason.message : typeof reason === 'object' && reason !== null
    ? JSON.stringify(reason) : String(reason)
  return new RegExp(`unknown (remote )?method|method .*${method}.*not found|does not exist`, 'i').test(message)
}

/**
 * One session's Review cache. All writes funnel through private state plus
 * `publish()`; the published snapshot object only changes identity when the
 * data actually moved, so `useSyncExternalStore` subscribers re-render
 * precisely.
 */
export class ReviewCacheController {
  private readonly remote: TypertClientRemote
  private readonly sessionId: SessionId
  private readonly session: ObservableSnapshot<ConversationSnapshot>
  private readonly prefetchLimit: number
  private readonly cacheLimit: number
  private readonly cacheBytes: number

  private state = EMPTY_SNAPSHOT
  private listeners = new Set<() => void>()
  private meta = EMPTY_META
  private totals = EMPTY_TOTALS
  private metaListeners = new Set<() => void>()
  private totalsListeners = new Set<() => void>()
  private historyListeners = new Set<() => void>()
  private fileListeners = new Map<string, Set<() => void>>()
  private generation = 0
  /** Opaque Host generation; distinct from the local request sequence above. */
  private hostGeneration: string | null = null
  private hostEpoch = 0
  private generationProtocol: 'unknown' | 'available' | 'legacy' = 'unknown'
  private readonly sourceCache = new Map<string, Promise<string | null>>()
  private readonly diffParser = new ReviewDiffParser()
  private stamp = 0
  private disposed = false
  private queues: Record<ReviewLoadPriority, string[]> = { focus: [], viewport: [], overscan: [], idle: [] }
  private drainEpoch = 0
  private drainingEpoch: number | null = null
  private drainScheduled = false
  private queued = new Map<string, ReviewLoadPriority>()
  private requestSerial = 0
  private activeRequests = new Map<string, number>()
  private resident: ReadonlySet<string> = new Set()
  private visible = false
  private initializing = true
  private checksPending = false
  private invalidateTimer: number | null = null
  private seenMutations: MutationSignal = { count: 0, lastSeq: 0, lastName: '', lastPath: null }
  private seenTurnEnds = -1
  private unsubscribeSession: () => void
  private historyTimer: number | null = null
  private turnEndHistoryTimer: number | null = null
  private metadataTimer: number | null = null
  private turnStatsLoading = false
  private readonly turnStats = new Map<string, { additions: number; deletions: number }>()
  private readonly views = new Map<string, ReviewCacheSnapshot>()
  private readonly onWindowFocus = (): void => { if (!this.disposed) void this.refresh({ silent: true }) }

  constructor(options: {
    remote: TypertClientRemote
    sessionId: SessionId
    session: ObservableSnapshot<ConversationSnapshot>
    prefetchLimit?: number
    cacheLimit?: number
    cacheBytes?: number
  }) {
    this.remote = options.remote
    this.sessionId = options.sessionId
    this.session = options.session
    this.prefetchLimit = options.prefetchLimit ?? REVIEW_PREFETCH_LIMIT
    this.cacheLimit = options.cacheLimit ?? REVIEW_CACHE_LIMIT
    this.cacheBytes = options.cacheBytes ?? REVIEW_CACHE_BYTES
    // Seed the event baselines from the current snapshot: history that
    // predates this controller must not fire an invalidation.
    const initial = options.session.getSnapshot()
    this.seenMutations = decodeMutationSignal(encodeMutationSignal(mutationSignal(initial.nodes)))
    this.seenTurnEnds = initial.turnEnds.size
    this.unsubscribeSession = options.session.subscribe(() => { this.onSessionSnapshot() })
    void this.initialize().finally(() => {
      this.initializing = false
      if (!this.disposed && this.visible) {
        this.prefetchIdle()
        if (this.checksPending) {
          this.checksPending = false
          void this.refresh({ silent: true, runChecks: true })
        }
      }
    })
    if (typeof window !== 'undefined') {
      this.historyTimer = window.setInterval(() => {
        if (this.disposed || !this.visible || document.visibilityState !== 'visible'
          || this.generationProtocol !== 'available') return
        void this.probe()
      }, PROBE_POLL_MS)
      window.addEventListener('focus', this.onWindowFocus)
    }
  }

  private async initialize(): Promise<void> {
    const outcome = await this.refresh()
    if (this.disposed || outcome.kind === 'superseded') return
    if (this.state.status?.workspaceKind === 'filesystem' && this.state.repository === '') {
      // A legacy Host has no manifest-carried history. Await its one required
      // history read before choosing the filesystem-only Turn scope.
      if (this.state.history === null) await this.refreshHistory(true)
      const latest = this.state.history?.turns.find(turn => turn.remainingFiles > 0)
      if (latest !== undefined && typeof this.state.scope === 'string') {
        this.publish({ scope: { turn: latest.turn } })
        await this.refresh()
      }
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): ReviewCacheSnapshot => this.state

  readonly subscribeMeta = (listener: () => void): (() => void) => {
    this.metaListeners.add(listener)
    return () => { this.metaListeners.delete(listener) }
  }

  readonly getMetaSnapshot = (): ReviewMetaSnapshot => this.meta

  readonly subscribeTotals = (listener: () => void): (() => void) => {
    this.totalsListeners.add(listener)
    return () => { this.totalsListeners.delete(listener) }
  }

  readonly getTotalsSnapshot = (): ReviewTotalsSnapshot => this.totals

  readonly subscribeHistory = (listener: () => void): (() => void) => {
    this.historyListeners.add(listener)
    return () => { this.historyListeners.delete(listener) }
  }

  readonly getHistorySnapshot = (): HistoryOk | null => this.state.history

  subscribeFile(path: string, listener: () => void): () => void {
    let listeners = this.fileListeners.get(path)
    if (listeners === undefined) { listeners = new Set(); this.fileListeners.set(path, listeners) }
    listeners.add(listener)
    return () => {
      listeners?.delete(listener)
      if (listeners?.size === 0) this.fileListeners.delete(path)
    }
  }

  getFileSnapshot(path: string): FileEntry | undefined { return this.state.entries[path] }

  getFileSummary(path: string): ReviewFileSummary | undefined {
    return this.state.summary?.files.find(file => file.path === path)
  }

  async selectScope(scope: ReviewScope, focusPath?: string): Promise<ReviewRefreshOutcome> {
    const selected = this.state.history?.workspaceKind === 'filesystem' && this.state.repository === '' && typeof scope === 'string'
      ? (() => {
          const latest = this.state.history?.turns.find(turn => turn.remainingFiles > 0)
          return latest === undefined ? scope : { turn: latest.turn } as ReviewScope
        })()
      : scope
    const same = JSON.stringify(selected) === JSON.stringify(this.state.scope)
    if (!same) {
      this.hostGeneration = null
      this.clearQueues()
      this.resident = new Set()
      this.publish({ scope: selected, status: null, summary: null, entries: {}, error: null })
    }
    // Scope selection and file reveal are user gestures: surface a failed
    // status request instead of leaving an unexplained blank panel.
    return this.refresh({ ...(focusPath === undefined ? {} : { focusPath }), silent: false })
  }

  /** Drill into a nested repository without replacing the Workbench panel. */
  async selectRepository(repository: string, scope: ReviewScope = 'uncommitted', focusPath?: string): Promise<ReviewRefreshOutcome> {
    const normalized = repository.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
    if (normalized === this.state.repository) return this.selectScope(scope, focusPath)
    this.views.set(this.state.repository, this.state)
    this.generation += 1
    this.hostGeneration = null
    this.clearQueues()
    this.resident = new Set()
    const retained = this.views.get(normalized)
    this.publish(retained === undefined ? {
      repository: normalized, scope, status: null, checks: null, summary: null, entries: {}, error: null, warning: null,
    } : {
      ...retained,
      history: this.state.history,
      repository: normalized,
      ...(JSON.stringify(retained.scope) === JSON.stringify(scope) ? {} : { scope, status: null, summary: null, entries: {} }),
      error: null,
    })
    return this.refresh({ ...(focusPath === undefined ? {} : { focusPath }), silent: false })
  }

  async refreshHistory(silent = false, refreshOnHeadChange = false): Promise<boolean> {
    try {
      const wire = await this.remote.review.history(this.sessionId)
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) throw new Error(wire.value.message)
      if (!this.disposed) {
        const history = this.mergeTurnStats(wire.value)
        const previousHead = this.state.history?.head
        const selectedScope = this.state.scope
        const selectedTurn = typeof selectedScope === 'object'
          ? history.turns.find(turn => turn.turn === selectedScope.turn)
          : undefined
        const previouslySelectedTurn = typeof selectedScope === 'object'
          ? this.state.history?.turns.find(turn => turn.turn === selectedScope.turn)
          : undefined
        const clearCompletedTurn = typeof selectedScope === 'object'
          && (selectedTurn?.remainingFiles === 0
            || (selectedTurn === undefined && previouslySelectedTurn !== undefined))
        if (clearCompletedTurn) {
          // Drop historical source/patch caches as soon as reconciliation
          // removes the fully committed turn (or a legacy Host marks it done).
          this.generation += 1
          this.clearQueues()
          this.resident = new Set()
          this.publish({
            history,
            scope: 'uncommitted',
            status: null,
            summary: null,
            entries: {},
            ...(silent ? {} : { error: null }),
          })
          void this.refresh({ silent: true })
        } else {
          if (!sameHistory(this.state.history, history)) this.publish({ history, ...(silent ? {} : { error: null }) })
          else if (!silent && this.state.error !== null) this.publish({ error: null })
        }
        void this.hydrateMissingTurnStats(history)
        if (!clearCompletedTurn && refreshOnHeadChange && previousHead !== undefined && history.head !== previousHead) {
          void this.refresh({ silent: true })
        }
      }
      return true
    } catch (reason) {
      if (!silent && !this.disposed) this.publish({ error: reason instanceof Error ? reason.message : String(reason) })
      return false
    }
  }

  private turnStatsKey(turn: number, path: string): string {
    return `${turn}\0${path}`
  }

  private mergeTurnStats(history: HistoryOk): HistoryOk {
    let moved = false
    const turns = history.turns.map(turn => {
      let filesMoved = false
      const files = turn.files.map(file => {
        if (file.additions !== undefined && file.deletions !== undefined) {
          this.turnStats.set(this.turnStatsKey(turn.turn, file.path), { additions: file.additions, deletions: file.deletions })
          return file
        }
        const cached = this.turnStats.get(this.turnStatsKey(turn.turn, file.path))
        if (cached === undefined) return file
        moved = true
        filesMoved = true
        return { ...file, ...cached }
      })
      if (!files.every(file => file.additions !== undefined && file.deletions !== undefined)) {
        return filesMoved ? { ...turn, files } : turn
      }
      const additions = files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
      const deletions = files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
      if (turn.additions === additions && turn.deletions === deletions && !filesMoved) return turn
      moved = true
      return { ...turn, files, additions, deletions }
    })
    return moved ? { ...history, turns } : history
  }

  private async hydrateMissingTurnStats(history: HistoryOk): Promise<void> {
    if (this.turnStatsLoading || this.disposed) return
    const missingTurns = history.turns.filter(turn => turn.remainingFiles > 0
      && turn.files.some(file => file.additions === undefined || file.deletions === undefined))
    if (missingTurns.length === 0) return
    this.turnStatsLoading = true
    try {
      for (const turn of missingTurns) {
        if (this.disposed) return
        let summarized = false
        try {
          const wire = await rootArityCompatible(
            async () => await this.remote.review.summary(this.sessionId, { turn: turn.turn }, undefined),
            async () => await this.remote.review.summary(this.sessionId, { turn: turn.turn }),
          )
          if (wire.ok && wire.value.ok) {
            for (const file of wire.value.files) {
              if (file.additions === undefined || file.deletions === undefined) continue
              this.turnStats.set(this.turnStatsKey(turn.turn, file.path), {
                additions: file.additions,
                deletions: file.deletions,
              })
            }
            summarized = true
          }
        } catch { /* Old Host: fall back to its per-file Diff contract. */ }
        if (summarized) continue
        for (const file of turn.files.filter(file => file.additions === undefined || file.deletions === undefined)) {
          const wire = await rootArityCompatible(
            async () => await this.remote.review.diff(this.sessionId, file.path, { turn: turn.turn }, undefined),
            async () => await this.remote.review.diff(this.sessionId, file.path, { turn: turn.turn }),
          )
          if (!wire.ok || !wire.value.ok) continue
          const parsed = await this.diffParser.parse(wire.value)
          this.turnStats.set(this.turnStatsKey(turn.turn, file.path), {
            additions: parsed.added,
            deletions: parsed.removed,
          })
        }
      }
      if (!this.disposed && this.state.history !== null) {
        const merged = this.mergeTurnStats(this.state.history)
        if (merged !== this.state.history) this.publish({ history: merged })
      }
    } finally {
      this.turnStatsLoading = false
    }
  }

  async undoTurn(turn: number): Promise<ReviewUndoTurnResult> {
    const wire = await this.remote.review.undoTurn(this.sessionId, turn)
    if (!wire.ok) throw transportError(wire)
    await this.refreshHistory(true)
    await this.refresh({ silent: true })
    return wire.value
  }

  /** Resolve a chat file click against freshly reconciled turn history. */
  async resolveTurnFile(turn: number, path: string): Promise<'pending' | 'resolved' | 'unknown'> {
    await this.refreshHistory(true)
    const record = this.state.history?.turns.find(item => item.turn === turn)
    if (record === undefined) return 'unknown'
    const normalized = path.replaceAll('\\', '/')
    const turnFile = record?.files.find(file => {
      const candidates = [file.path, file.oldPath].filter((item): item is string => item !== undefined)
      return candidates.some(candidate => normalized === candidate || normalized.endsWith(`/${candidate}`))
    })
    if (turnFile === undefined) return 'unknown'
    return turnFile.state === 'pending' ? 'pending' : 'resolved'
  }

  /** Heavy bodies near the viewport are exempt from weighted cache eviction. */
  setResident(paths: ReadonlySet<string>): void {
    this.resident = paths
    let superseded = false
    // Viewport and overscan demand are edge-triggered. A fast scrollbar jump
    // must not drain files that have already left the mounted window.
    for (const priority of ['viewport', 'overscan', 'idle'] as const) {
      const kept = this.queues[priority].filter(path => paths.has(path))
      if (kept.length !== this.queues[priority].length) superseded = true
      this.queues[priority] = kept
    }
    if (superseded) {
      this.queued.clear()
      for (const priority of PRIORITY_ORDER) {
        for (const path of this.queues[priority]) this.queued.set(path, priority)
      }
    }
    const obsolete = new Map([...this.activeRequests].filter(([path]) => !paths.has(path)))
    if (obsolete.size > 0) {
      // Let a fresh drain start without waiting for an obsolete transport.
      // Its late response loses request ownership and is ignored.
      this.drainEpoch += 1
      this.releasePatchRequests(obsolete, false)
      superseded = true
    }
    if (superseded) this.scheduleDrain()
    const evicted = evictCollapsedCaches(this.state.entries, this.resident, this.cacheLimit, this.cacheBytes)
    if (evicted !== null) this.replaceEntries(evicted)
  }

  /** Panel visibility: the hidden→visible edge is the catch-all refresh. */
  setVisible(visible: boolean): void {
    const was = this.visible
    this.visible = visible
    if (visible && !was) {
      // The constructor's metadata request observes `visible` before it
      // publishes and schedules the first six files itself. Avoid issuing a
      // duplicate status request when the panel mounts immediately.
      if (this.initializing) return
      const runChecks = this.checksPending
      this.checksPending = false
      void this.refresh({ silent: true, runChecks })
    }
  }

  /** User gesture on one file: fetch or revalidate it now, ahead of the queue. */
  ensure(path: string, priority: ReviewLoadPriority = 'viewport', fresh = false): void {
    const entry = this.state.entries[path]
    if (entry === undefined || entry.fetching) return
    if (entry.status.kind === 'repository' || entry.status.kind === 'submodule') return
    this.setEntry(path, current => ({ ...current, lastOpened: ++this.stamp }))
    if (entry.cache.kind === 'ready') {
      if (fresh && !entry.stale) this.setEntry(path, current => ({ ...current, stale: true }))
      if (fresh || entry.stale) this.enqueue([path], priority)
      return
    }
    if (entry.cache.kind === 'empty' || entry.cache.kind === 'error') this.enqueue([path], priority)
  }

  /** Lazy full source for one expanded context fold in the active generation. */
  async source(path: string, side: 'old' | 'new'): Promise<string | null> {
    const generation = this.hostGeneration
    if (generation === null || typeof this.remote.review.source !== 'function') return null
    const key = `${generation}\0${path}\0${side}`
    const cached = this.sourceCache.get(key)
    if (cached !== undefined) return await cached
    const request = (async () => {
      const wire = await this.remote.review.source(this.sessionId, generation, path, side)
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) {
        if (wire.value.code === 'STALE_GENERATION') void this.refresh({ silent: true })
        throw new Error(wire.value.message)
      }
      return wire.value.text
    })()
    this.sourceCache.set(key, request)
    try { return await request } catch (reason) { this.sourceCache.delete(key); throw reason }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.invalidateTimer !== null) window.clearTimeout(this.invalidateTimer)
    if (this.historyTimer !== null) window.clearInterval(this.historyTimer)
    if (this.turnEndHistoryTimer !== null) window.clearTimeout(this.turnEndHistoryTimer)
    if (this.metadataTimer !== null) window.clearTimeout(this.metadataTimer)
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onWindowFocus)
    this.unsubscribeSession()
    this.listeners.clear()
    this.metaListeners.clear()
    this.totalsListeners.clear()
    this.historyListeners.clear()
    this.fileListeners.clear()
    this.sourceCache.clear()
    this.activeRequests.clear()
    this.diffParser.dispose()
  }

  private publish(patch: Partial<ReviewCacheSnapshot>): void {
    const previous = this.state
    this.state = { ...this.state, ...patch }
    if (patch.entries !== undefined && patch.entries !== previous.entries) {
      const paths = new Set([...Object.keys(previous.entries), ...Object.keys(patch.entries)])
      for (const path of paths) {
        if (previous.entries[path] === patch.entries[path]) continue
        for (const listener of this.fileListeners.get(path) ?? []) listener()
      }
    }
    if (patch.history !== undefined && patch.history !== previous.history) {
      for (const listener of this.historyListeners) listener()
    }
    if (patch.status !== undefined || patch.checks !== undefined || patch.summary !== undefined || patch.scope !== undefined
      || patch.repository !== undefined || patch.error !== undefined || patch.warning !== undefined) {
      const nextMeta: ReviewMetaSnapshot = {
        status: this.state.status,
        checks: this.state.checks,
        summary: this.state.summary,
        scope: this.state.scope,
        repository: this.state.repository,
        error: this.state.error,
        warning: this.state.warning,
      }
      if (nextMeta.status !== this.meta.status || nextMeta.checks !== this.meta.checks
        || nextMeta.summary !== this.meta.summary || nextMeta.scope !== this.meta.scope || nextMeta.repository !== this.meta.repository
        || nextMeta.error !== this.meta.error || nextMeta.warning !== this.meta.warning) {
        this.meta = nextMeta
        for (const listener of this.metaListeners) listener()
      }
    }
    if (patch.entries !== undefined || patch.summary !== undefined) this.updateTotals()
    for (const listener of this.listeners) listener()
  }

  private updateTotals(): void {
    let added = this.state.summary?.additions ?? 0
    let removed = this.state.summary?.deletions ?? 0
    if (this.state.summary === null) {
      for (const entry of Object.values(this.state.entries)) {
        if (entry.cache.kind !== 'ready') continue
        added += entry.cache.added
        removed += entry.cache.removed
      }
    }
    if (added === this.totals.added && removed === this.totals.removed) return
    this.totals = { added, removed }
    for (const listener of this.totalsListeners) listener()
  }

  private replaceEntries(entries: FileEntries): void { this.publish({ entries }) }

  private setEntry(path: string, mutate: (entry: FileEntry) => FileEntry): void {
    const existing = this.state.entries[path]
    if (existing === undefined) return
    const next = mutate(existing)
    if (next === existing) return
    // Path-level updates keep the compatibility snapshot immutable, but skip
    // publish()'s bulk key comparison and totals scan. Only this file, totals,
    // and legacy whole-snapshot subscribers are notified.
    this.state = { ...this.state, entries: { ...this.state.entries, [path]: next } }
    for (const listener of this.fileListeners.get(path) ?? []) listener()
    if (this.state.summary === null) {
      const contribution = (entry: FileEntry): ReviewTotalsSnapshot => entry.cache.kind === 'ready'
        ? { added: entry.cache.added, removed: entry.cache.removed }
        : EMPTY_TOTALS
      const before = contribution(existing)
      const after = contribution(next)
      const totals = {
        added: this.totals.added - before.added + after.added,
        removed: this.totals.removed - before.removed + after.removed,
      }
      if (totals.added !== this.totals.added || totals.removed !== this.totals.removed) {
        this.totals = totals
        for (const listener of this.totalsListeners) listener()
      }
    }
    for (const listener of this.listeners) listener()
  }

  private generationDiff(file: ReviewPatchFile): Extract<ReviewDiffResult, { ok: true }> {
    const status = this.state.status
    if (status === null) throw new Error('Review manifest is unavailable.')
    return {
      ok: true,
      repositoryRoot: status.repositoryRoot,
      workspaceKind: status.workspaceKind,
      scope: this.state.scope,
      ...(status.location === undefined ? {} : { location: status.location }),
      path: file.path,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      ...(file.kind === undefined ? {} : { kind: file.kind }),
      ...(file.presentation === undefined ? {} : { presentation: file.presentation }),
      ...(file.lineStatsState === undefined ? {} : { lineStatsState: file.lineStatsState }),
      layers: file.layers.map(layer => ({
        kind: layer.kind,
        patch: layer.patch,
        oldSource: { revision: layer.oldRevision, text: null, ...(layer.oldLineCount === undefined ? {} : { lineCount: layer.oldLineCount }) },
        newSource: { revision: layer.newRevision, text: null, ...(layer.newLineCount === undefined ? {} : { lineCount: layer.newLineCount }) },
      })),
    }
  }

  /** Release request ownership after a generation/sequence is superseded. */
  private releasePatchRequests(requests: ReadonlyMap<string, number>, retry: boolean): void {
    for (const [path, request] of requests) {
      if (this.activeRequests.get(path) !== request) continue
      this.activeRequests.delete(path)
      const entry = this.state.entries[path]
      if (entry === undefined || !entry.fetching) continue
      this.setEntry(path, current => ({
        ...current,
        fetching: false,
        cache: current.cache.kind === 'loading' ? { kind: 'empty' } : current.cache,
      }))
      if (retry && this.resident.has(path)) this.enqueue([path], 'viewport')
    }
  }

  private async loadPatchBatch(paths: readonly string[]): Promise<void> {
    const hostGeneration = this.hostGeneration
    if (hostGeneration === null || paths.length === 0) return
    const sequence = this.generation
    const requested = paths.filter(path => {
      const entry = this.state.entries[path]
      return entry !== undefined && !entry.fetching
        && (entry.cache.kind === 'empty' || entry.cache.kind === 'error' || entry.cache.kind === 'ready' && entry.stale)
    })
    if (requested.length === 0) return
    const requests = new Map<string, number>()
    for (const path of requested) {
      const request = ++this.requestSerial
      requests.set(path, request)
      this.activeRequests.set(path, request)
      this.setEntry(path, entry => ({
        ...entry,
        fetching: true,
        ...(entry.cache.kind === 'ready' ? {} : { cache: { kind: 'loading' } as const }),
      }))
    }
    try {
      const wire = await this.remote.review.patches(this.sessionId, hostGeneration, [...requested])
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) {
        if (wire.value.code === 'STALE_GENERATION') {
          this.releasePatchRequests(requests, false)
          await this.refresh({ silent: true })
          for (const path of requested) if (this.resident.has(path)) this.ensure(path, 'viewport')
          return
        }
        throw new Error(wire.value.message)
      }
      if (this.disposed || sequence !== this.generation || hostGeneration !== this.hostGeneration) {
        this.releasePatchRequests(requests, !this.disposed)
        return
      }
      const files = new Map(wire.value.files.map(file => [file.path, file] as const))
      const prepared = new Map<string, ReadyCache>()
      await Promise.all(requested.map(async path => {
        const file = files.get(path)
        if (file === undefined || this.state.entries[path] === undefined) return
        const result = this.generationDiff(file)
        const previous = this.state.entries[path]?.cache
        prepared.set(path, previous?.kind === 'ready' && sameDiffResult(previous.raw, result)
          ? previous
          : { kind: 'ready', ...await this.diffParser.parse(result), raw: result })
      }))
      if (this.disposed || sequence !== this.generation || hostGeneration !== this.hostGeneration) {
        this.releasePatchRequests(requests, !this.disposed)
        return
      }
      for (const path of requested) {
        const request = requests.get(path)
        if (request === undefined || this.activeRequests.get(path) !== request) continue
        const cache = prepared.get(path)
        if (cache === undefined || this.state.entries[path] === undefined) {
          this.activeRequests.delete(path)
          this.setEntry(path, entry => ({ ...entry, fetching: false, cache: { kind: 'error', message: 'Patch missing from generation.' } }))
          continue
        }
        this.activeRequests.delete(path)
        this.setEntry(path, entry => ({ ...entry, fetching: false, cache, stale: false }))
      }
      const evicted = evictCollapsedCaches(this.state.entries, this.resident, this.cacheLimit, this.cacheBytes)
      if (evicted !== null) this.replaceEntries(evicted)
    } catch (reason) {
      if (this.disposed || sequence !== this.generation || hostGeneration !== this.hostGeneration) {
        this.releasePatchRequests(requests, !this.disposed)
        return
      }
      const message = reason instanceof Error ? reason.message : String(reason)
      for (const path of requested) {
        const request = requests.get(path)
        if (request === undefined || this.activeRequests.get(path) !== request) continue
        this.activeRequests.delete(path)
        this.setEntry(path, entry => ({
          ...entry,
          fetching: false,
          ...(entry.cache.kind === 'ready' ? {} : { cache: { kind: 'error', message } }),
        }))
      }
    }
  }

  private async loadDiff(path: string, revalidate: boolean): Promise<void> {
    const current = this.state.entries[path]
    if (current === undefined || current.fetching) return
    if (revalidate ? current.cache.kind !== 'ready' : (current.cache.kind !== 'empty' && current.cache.kind !== 'error')) return
    const generation = this.generation
    const scope = this.state.scope
    const repository = this.state.repository
    const request = ++this.requestSerial
    const requests = new Map([[path, request]])
    this.activeRequests.set(path, request)
    this.setEntry(path, entry => ({
      ...entry,
      fetching: true,
      // A revalidate keeps the cached content visible until it resolves.
      ...(revalidate ? {} : { cache: { kind: 'loading' } as const }),
    }))
    try {
      const location = locationArgument(repository)
      const wire = location === undefined
        ? await rootArityCompatible(
            async () => await this.remote.review.diff(this.sessionId, path, scope, undefined),
            async () => await this.remote.review.diff(this.sessionId, path, scope),
          )
        : await this.remote.review.diff(this.sessionId, path, scope, location)
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) throw new Error(wire.value.message)
      const result = wire.value
      if (result.path !== path) {
        throw new Error(`Review diff path mismatch: requested ${path}, received ${result.path}.`)
      }
      if (this.disposed || generation !== this.generation || this.state.entries[path] === undefined) {
        this.releasePatchRequests(requests, !this.disposed)
        return
      }
      if (this.activeRequests.get(path) !== request) return
      // Identical wire content keeps the previous parse object, so a no-op
      // revalidate costs no re-render inside the panel.
      const previous = this.state.entries[path]?.cache
      const cache: ReadyCache = previous !== undefined && previous.kind === 'ready' && sameDiffResult(previous.raw, result)
        ? previous
        : { kind: 'ready', ...await this.diffParser.parse(result), raw: result }
      if (this.disposed || generation !== this.generation || this.state.entries[path] === undefined) {
        this.releasePatchRequests(requests, !this.disposed)
        return
      }
      if (this.activeRequests.get(path) !== request) return
      this.activeRequests.delete(path)
      this.setEntry(path, entry => ({ ...entry, fetching: false, cache, stale: false }))
      const evicted = evictCollapsedCaches(this.state.entries, this.resident, this.cacheLimit, this.cacheBytes)
      if (evicted !== null) this.replaceEntries(evicted)
    } catch (reason) {
      if (this.disposed || generation !== this.generation) {
        this.releasePatchRequests(requests, !this.disposed)
        return
      }
      if (this.activeRequests.get(path) !== request) return
      this.activeRequests.delete(path)
      const message = reason instanceof Error ? reason.message : String(reason)
      // A failed revalidate keeps the cached content; the entry stays stale
      // and the next signal retries.
      this.setEntry(path, entry => ({
        ...entry,
        fetching: false,
        ...(revalidate ? {} : { cache: { kind: 'error', message } }),
      }))
    }
  }

  private clearQueues(): void {
    this.drainEpoch += 1
    this.releasePatchRequests(new Map(this.activeRequests), false)
    this.queues = { focus: [], viewport: [], overscan: [], idle: [] }
    this.queued.clear()
  }

  private prefetchIdle(): void {
    // Generation clients are driven by virtual-viewport residency. Keep the
    // small legacy warm-up only for old Hosts whose RPC is per-file.
    if (!this.visible || this.hostGeneration !== null) return
    const paths = this.state.status?.files
      .filter(file => file.kind !== 'repository' && file.kind !== 'submodule')
      .slice(0, REVIEW_IDLE_PREFETCH_LIMIT).map(file => file.path) ?? []
    this.enqueue(paths, 'idle')
  }

  /** Append paths to the sequential priority queue (in order, deduped). */
  private enqueue(paths: Iterable<string>, priority: ReviewLoadPriority): void {
    let idleQueued = this.queues.idle.length
    for (const path of paths) {
      if (priority === 'idle' && idleQueued >= Math.min(this.prefetchLimit, REVIEW_IDLE_PREFETCH_LIMIT)) break
      const existing = this.queued.get(path)
      if (existing !== undefined && PRIORITY_RANK[existing] <= PRIORITY_RANK[priority]) continue
      this.queued.set(path, priority)
      this.queues[priority].push(path)
      if (priority === 'idle') idleQueued += 1
    }
    this.scheduleDrain()
  }

  private scheduleDrain(): void {
    if (this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      if (!this.disposed) void this.drain()
    })
  }

  private takeNext(): string | undefined {
    for (const priority of PRIORITY_ORDER) {
      while (this.queues[priority].length > 0) {
        const path = this.queues[priority].shift()
        if (path === undefined || this.queued.get(path) !== priority) continue
        this.queued.delete(path)
        return path
      }
    }
    return undefined
  }

  private takeBatch(): string[] {
    const batch: string[] = []
    while (batch.length < PATCH_BATCH_LIMIT) {
      const path = this.takeNext()
      if (path === undefined) break
      batch.push(path)
    }
    return batch
  }

  private async drain(): Promise<void> {
    const epoch = this.drainEpoch
    if (this.drainingEpoch === epoch) return
    this.drainingEpoch = epoch
    try {
      while (!this.disposed && epoch === this.drainEpoch) {
        const paths = this.takeBatch()
        if (paths.length === 0) break
        if (this.hostGeneration !== null) await this.loadPatchBatch(paths)
        else for (const path of paths) {
          const entry = this.state.entries[path]
          if (entry === undefined) continue
          if (entry.cache.kind === 'empty' || entry.cache.kind === 'error') await this.loadDiff(path, false)
          else if (entry.cache.kind === 'ready' && entry.stale) await this.loadDiff(path, true)
        }
        // Yield between batches so even the synchronous old-Host fallback
        // cannot monopolize the main thread; generation parsing normally
        // completes in the controller-owned Worker before this point.
        await new Promise(resolve => { setTimeout(resolve, 0) })
      }
    } finally {
      if (this.drainingEpoch === epoch) this.drainingEpoch = null
    }
  }

  private async refreshSummary(sequence: number, scope: ReviewScope): Promise<void> {
    try {
      const location = locationArgument(this.state.repository)
      const wire = location === undefined
        ? await rootArityCompatible(
            async () => await this.remote.review.summary(this.sessionId, scope, undefined),
            async () => await this.remote.review.summary(this.sessionId, scope),
          )
        : await this.remote.review.summary(this.sessionId, scope, location)
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) throw new Error(wire.value.message)
      if (sequence !== this.generation || this.disposed) return
      if (!sameSummary(this.state.summary, wire.value)) this.publish({ summary: wire.value })
      if (this.state.warning !== null) this.publish({ warning: null })
    } catch (reason) {
      // Only the explicit old-Host missing-method case is silent. A genuine
      // statistics failure must not blank status/diffs, but it is visible.
      if (!missingSummaryMethod(reason) && sequence === this.generation && !this.disposed) {
        this.publish({ warning: reason instanceof Error ? reason.message : String(reason) })
      }
    }
  }

  /** Let focus/viewport patches claim Host and Worker capacity before totals/history reconciliation. */
  private scheduleDeferredMetadata(sequence: number, scope: ReviewScope, summaryPending: boolean, historyPending: boolean): void {
    if (!summaryPending && !historyPending) return
    if (this.metadataTimer !== null && typeof window !== 'undefined') window.clearTimeout(this.metadataTimer)
    const run = (): void => {
      this.metadataTimer = null
      if (this.disposed || sequence !== this.generation) return
      if (summaryPending) void this.refreshSummary(sequence, scope)
      if (historyPending && this.state.history === null) void this.refreshHistory(true)
    }
    if (typeof window === 'undefined') { queueMicrotask(run); return }
    this.metadataTimer = window.setTimeout(run, DEFERRED_METADATA_MS)
  }

  private async fetchManifest(scope: ReviewScope, repository: string): Promise<ManifestOk | null> {
    if (this.generationProtocol === 'legacy') return null
    if (typeof this.remote.review.manifest !== 'function') {
      this.generationProtocol = 'legacy'
      return null
    }
    try {
      const wire = await this.remote.review.manifest(this.sessionId, scope, locationArgument(repository))
      if (!wire.ok) {
        if (missingRemoteMethod(wire, 'manifest')) { this.generationProtocol = 'legacy'; return null }
        throw transportError(wire)
      }
      if (!wire.value.ok) throw new Error(wire.value.message)
      this.generationProtocol = 'available'
      return wire.value
    } catch (reason) {
      if (missingRemoteMethod(reason, 'manifest')) { this.generationProtocol = 'legacy'; return null }
      throw reason
    }
  }

  private manifestViews(manifest: ManifestOk): { status: StatusOk; summary: SummaryOk | null; history: HistoryOk | null } {
    const status: StatusOk = {
      ok: true,
      repositoryRoot: manifest.repositoryRoot,
      workspaceKind: manifest.workspaceKind,
      branch: manifest.branch,
      scope: manifest.scope,
      ...(manifest.location === undefined ? {} : { location: manifest.location }),
      files: manifest.files.map(({ additions: _additions, deletions: _deletions, binary: _binary,
        lineStatsState: _lineStatsState, ...file }) => file),
    }
    const summary: SummaryOk | null = manifest.summaryPending === true ? null : {
      ok: true,
      repositoryRoot: manifest.repositoryRoot,
      workspaceKind: manifest.workspaceKind,
      scope: manifest.scope,
      ...(manifest.location === undefined ? {} : { location: manifest.location }),
      additions: manifest.additions,
      deletions: manifest.deletions,
      files: manifest.files.map(({ index: _index, workingTree: _workingTree, lineStatsState, ...file }) => ({
        ...file,
        ...(lineStatsState === undefined ? {} : { lineStatsState: lineStatsState === 'pending' ? 'unknown' as const : lineStatsState }),
      })),
    }
    const history: HistoryOk | null = manifest.historyPending === true ? null : {
      ok: true,
      repositoryRoot: manifest.repositoryRoot,
      workspaceKind: manifest.workspaceKind,
      ...(manifest.head === undefined ? {} : { head: manifest.head }),
      turns: manifest.turns,
    }
    return { status, summary, history }
  }

  private async probe(): Promise<void> {
    if (typeof this.remote.review.probe !== 'function') {
      this.generationProtocol = 'legacy'
      return
    }
    try {
      const wire = await this.remote.review.probe(this.sessionId, this.hostEpoch)
      if (!wire.ok) {
        if (missingRemoteMethod(wire, 'probe')) this.generationProtocol = 'legacy'
        return
      }
      if (!wire.value.ok) return
      this.hostEpoch = wire.value.epoch
      if (wire.value.changed) await this.refresh({ silent: true })
    } catch (reason) {
      if (missingRemoteMethod(reason, 'probe')) this.generationProtocol = 'legacy'
    }
  }

  async refresh(options: { focusPath?: string; runChecks?: boolean; silent?: boolean } = {}): Promise<ReviewRefreshOutcome> {
    const { focusPath, runChecks = false, silent = false } = options
    const seq = ++this.generation
    try {
      const location = locationArgument(this.state.repository)
      const manifest = await this.fetchManifest(this.state.scope, this.state.repository)
      let nextStatus: StatusOk
      let nextSummary: SummaryOk | null = null
      let nextHistory: HistoryOk | null = null
      if (manifest !== null) {
        const views = this.manifestViews(manifest)
        nextStatus = views.status
        nextSummary = views.summary
        nextHistory = views.history === null ? null : this.mergeTurnStats(views.history)
        if (this.hostGeneration !== manifest.generation) this.sourceCache.clear()
        this.hostGeneration = manifest.generation
        this.hostEpoch = manifest.epoch
      } else {
        this.hostGeneration = null
        const statusWire = location === undefined
          ? await rootArityCompatible(
              async () => await this.remote.review.status(this.sessionId, this.state.scope, undefined),
              async () => await this.remote.review.status(this.sessionId, this.state.scope),
            )
          : await this.remote.review.status(this.sessionId, this.state.scope, location)
        if (!statusWire.ok) throw transportError(statusWire)
        if (!statusWire.value.ok) throw new Error(statusWire.value.message)
        nextStatus = statusWire.value
      }
      let nextChecks: ChecksOk | null = null
      if (runChecks) {
        const checksWire = location === undefined
          ? await rootArityCompatible(
              async () => await this.remote.review.checks(this.sessionId, undefined),
              async () => await this.remote.review.checks(this.sessionId),
            )
          : await this.remote.review.checks(this.sessionId, location)
        if (!checksWire.ok) throw transportError(checksWire)
        if (!checksWire.value.ok) throw new Error(checksWire.value.message)
        nextChecks = checksWire.value
      }
      if (seq !== this.generation || this.disposed) return { kind: 'superseded' }
      // A fresh manifest owns a new opaque generation. Cancel every request
      // that was claimed while this refresh was in flight before merging the
      // new status, otherwise its `loading` flag can survive indefinitely.
      this.clearQueues()
      const merged = mergeFileEntries(this.state.entries, nextStatus.files, () => ++this.stamp)
      const keepSummary = nextSummary === null && sameStatusFiles(this.state.status, nextStatus)
      let focus: string | undefined
      if (focusPath !== undefined) focus = matchReviewFile(nextStatus.files, focusPath)
      this.publish({
        status: nextStatus,
        ...(nextSummary !== null ? { summary: nextSummary } : keepSummary ? {} : { summary: null }),
        ...(nextHistory === null ? {} : { history: nextHistory }),
        entries: merged,
        ...(nextChecks !== null ? { checks: nextChecks } : {}),
        error: null,
      })
      // A reveal focus wants the current content immediately; everything
      // else (new or stale) flows through the sequential background queue.
      if (focus !== undefined) this.ensure(focus, 'focus', true)
      for (const path of this.resident) if (path !== focus) this.ensure(path, 'viewport')
      this.prefetchIdle()
      if (manifest === null) {
        // Preserve old-Host timing and compatibility: legacy status never
        // carries either metadata view, so start its established RPCs now.
        if (nextSummary === null) void this.refreshSummary(seq, this.state.scope)
        if (nextHistory === null) void this.refreshHistory(true)
      } else {
        this.scheduleDeferredMetadata(seq, this.state.scope, nextSummary === null, nextHistory === null)
      }
      const evicted = evictCollapsedCaches(merged, this.resident, this.cacheLimit, this.cacheBytes)
      if (evicted !== null) this.publish({ entries: evicted })
      if (focusPath === undefined) return { kind: 'ready' }
      return focus === undefined ? { kind: 'missing' } : { kind: 'found', path: focus }
    } catch (reason) {
      if (seq !== this.generation || this.disposed) return { kind: 'superseded' }
      // Silent (background) failures keep the last good data; the manual
      // refresh keeps its visible error surface.
      const message = reason instanceof Error ? reason.message : String(reason)
      if (!silent) this.publish({ error: message })
      return { kind: 'error', message }
    }
  }

  /** Session event stream: settled mutation tools and finished turns. */
  private onSessionSnapshot(): void {
    if (this.disposed) return
    const snapshot = this.session.getSnapshot()
    const signal = decodeMutationSignal(encodeMutationSignal(mutationSignal(snapshot.nodes)))
    const previousMutations = this.seenMutations
    this.seenMutations = signal
    if (signal.count > previousMutations.count) {
      // A single new edit/write targets its file; anything else (or a burst)
      // invalidates the whole table.
      const single = signal.count - previousMutations.count === 1
      const target = single && signal.lastPath !== null ? signal.lastPath : null
      if (this.invalidateTimer !== null) window.clearTimeout(this.invalidateTimer)
      this.invalidateTimer = window.setTimeout(() => {
        this.invalidateTimer = null
        const files = this.state.status?.files
        const matched = target === null || files === undefined ? undefined : matchReviewFile(files, target)
        const marked = markStale(this.state.entries, matched === undefined ? null : new Set([matched]))
        if (marked !== this.state.entries) this.publish({ entries: marked })
        // A precise mutation is also a cache-warming signal. The controller
        // exists for the Session lifetime, so fetch this one patch even while
        // Review is hidden; opening the panel then consumes an already parsed
        // file instead of starting from Git. Unknown/burst writes retain the
        // metadata-only authoritative refresh.
        void this.refresh({ silent: true, ...(target === null ? {} : { focusPath: target }) })
      }, MUTATION_DEBOUNCE_MS)
    }
    const turnEndCount = snapshot.turnEnds.size
    if (this.seenTurnEnds < 0) {
      this.seenTurnEnds = turnEndCount
    } else if (turnEndCount > this.seenTurnEnds) {
      this.seenTurnEnds = turnEndCount
      // A finished turn re-runs checks; while the panel is hidden it defers
      // to the next visibility refresh.
      if (this.visible) void this.refresh({ silent: true, runChecks: true })
      else {
        this.checksPending = true
        // Host captureEnd is asynchronous on the same event. Read once now for
        // fast paths, then once after its workspace snapshot has had time to
        // settle; the hidden panel no longer needs a permanent two-second poll
        // of an open Turn just to discover this boundary.
        void this.refreshHistory(true)
        if (this.turnEndHistoryTimer !== null) window.clearTimeout(this.turnEndHistoryTimer)
        this.turnEndHistoryTimer = window.setTimeout(() => {
          this.turnEndHistoryTimer = null
          if (!this.disposed) void this.refreshHistory(true, true)
        }, TURN_END_HISTORY_RETRY_MS)
      }
    }
  }
}
