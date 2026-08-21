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
  ReviewChecksResult, ReviewFileSummary, ReviewHistoryResult, ReviewScope, ReviewStatusResult,
  ReviewSummaryResult, ReviewUndoTurnResult,
} from '@ryanyujazz/dsh-review/types'
import {
  REVIEW_CACHE_BYTES, REVIEW_CACHE_LIMIT, REVIEW_IDLE_PREFETCH_LIMIT, REVIEW_PREFETCH_LIMIT,
  decodeMutationSignal, encodeMutationSignal,
  evictCollapsedCaches, markStale, matchReviewFile, mergeFileEntries, mutationSignal,
  parseDiffResult, sameDiffResult, type FileEntries, type FileEntry, type MutationSignal, type ReadyCache,
} from './review-model.ts'

type StatusOk = Extract<ReviewStatusResult, { ok: true }>
type ChecksOk = Extract<ReviewChecksResult, { ok: true }>
type HistoryOk = Extract<ReviewHistoryResult, { ok: true }>
type SummaryOk = Extract<ReviewSummaryResult, { ok: true }>

/** The immutable view the panel renders through useSyncExternalStore. */
export interface ReviewCacheSnapshot {
  status: StatusOk | null
  checks: ChecksOk | null
  history: HistoryOk | null
  summary: SummaryOk | null
  scope: ReviewScope
  entries: Readonly<FileEntries>
  /** Manual-refresh error surface; background failures stay silent. */
  error: string | null
}

export type ReviewMetaSnapshot = Pick<ReviewCacheSnapshot, 'status' | 'checks' | 'summary' | 'scope' | 'error'>
export interface ReviewTotalsSnapshot { added: number; removed: number }

/** A focused refresh must not confuse cancellation or transport failure with a real miss. */
export type ReviewRefreshOutcome =
  | { kind: 'ready' }
  | { kind: 'found'; path: string }
  | { kind: 'missing' }
  | { kind: 'superseded' }
  | { kind: 'error'; message: string }

const EMPTY_SNAPSHOT: ReviewCacheSnapshot = {
  status: null, checks: null, history: null, summary: null, scope: 'uncommitted', entries: {}, error: null,
}

const EMPTY_META: ReviewMetaSnapshot = {
  status: null, checks: null, summary: null, scope: 'uncommitted', error: null,
}
const EMPTY_TOTALS: ReviewTotalsSnapshot = { added: 0, removed: 0 }

export type ReviewLoadPriority = 'focus' | 'viewport' | 'idle'
const PRIORITY_RANK: Record<ReviewLoadPriority, number> = { focus: 0, viewport: 1, idle: 2 }

/** Settled mutation tools are coalesced into one invalidation after this long. */
const MUTATION_DEBOUNCE_MS = 600

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
    && left.additions === right.additions
    && left.deletions === right.deletions
    && JSON.stringify(left.files) === JSON.stringify(right.files)
}

function sameStatusFiles(left: StatusOk | null, right: StatusOk): boolean {
  if (left === null || left.files.length !== right.files.length) return false
  return left.files.every((file, index) => {
    const other = right.files[index]
    return other !== undefined && file.path === other.path && file.oldPath === other.oldPath
  })
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
  private stamp = 0
  private disposed = false
  private queues: Record<ReviewLoadPriority, string[]> = { focus: [], viewport: [], idle: [] }
  private draining = false
  private queued = new Map<string, ReviewLoadPriority>()
  private resident: ReadonlySet<string> = new Set()
  private visible = false
  private initializing = true
  private checksPending = false
  private invalidateTimer: number | null = null
  private seenMutations: MutationSignal = { count: 0, lastSeq: 0, lastName: '', lastPath: null }
  private seenTurnEnds = -1
  private unsubscribeSession: () => void
  private historyTimer: number | null = null
  private turnStatsLoading = false
  private readonly turnStats = new Map<string, { additions: number; deletions: number }>()
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
        // Filesystem workspaces have no external HEAD to reconcile. Their
        // session mutation/turn events already invalidate Review; polling
        // would only rebuild a full temporary tree every two seconds.
        if (!this.disposed && document.visibilityState === 'visible'
          && this.state.history?.workspaceKind !== 'filesystem') void this.refreshHistory(true, true)
      }, 2_000)
      window.addEventListener('focus', this.onWindowFocus)
    }
  }

  private async initialize(): Promise<void> {
    const generation = this.generation
    await this.refreshHistory(true)
    // An explicit presentation/scope selection may arrive while the initial
    // history request is in flight. It owns initialization from that point;
    // do not issue a second refresh that can supersede its focused request.
    if (this.disposed || generation !== this.generation) return
    if (this.state.history?.workspaceKind === 'filesystem') {
      const latest = this.state.history.turns.find(turn => turn.remainingFiles > 0)
      if (latest !== undefined) this.publish({ scope: { turn: latest.turn } })
    }
    await this.refresh()
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
    const selected = this.state.history?.workspaceKind === 'filesystem' && typeof scope === 'string'
      ? (() => {
          const latest = this.state.history?.turns.find(turn => turn.remainingFiles > 0)
          return latest === undefined ? scope : { turn: latest.turn } as ReviewScope
        })()
      : scope
    const same = JSON.stringify(selected) === JSON.stringify(this.state.scope)
    if (!same) {
      this.clearQueues()
      this.resident = new Set()
      this.publish({ scope: selected, status: null, summary: null, entries: {}, error: null })
    }
    // Scope selection and file reveal are user gestures: surface a failed
    // status request instead of leaving an unexplained blank panel.
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
          const wire = await this.remote.review.summary(this.sessionId, { turn: turn.turn })
          if (wire.ok && wire.value.ok) {
            for (const file of wire.value.files) {
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
          const wire = await this.remote.review.diff(this.sessionId, file.path, { turn: turn.turn })
          if (!wire.ok || !wire.value.ok) continue
          const parsed = parseDiffResult(wire.value)
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
    this.setEntry(path, current => ({ ...current, lastOpened: ++this.stamp }))
    if (entry.cache.kind === 'ready') {
      if (fresh && !entry.stale) this.setEntry(path, current => ({ ...current, stale: true }))
      if (fresh || entry.stale) this.enqueue([path], priority)
      return
    }
    if (entry.cache.kind === 'empty' || entry.cache.kind === 'error') this.enqueue([path], priority)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.invalidateTimer !== null) window.clearTimeout(this.invalidateTimer)
    if (this.historyTimer !== null) window.clearInterval(this.historyTimer)
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onWindowFocus)
    this.unsubscribeSession()
    this.listeners.clear()
    this.metaListeners.clear()
    this.totalsListeners.clear()
    this.historyListeners.clear()
    this.fileListeners.clear()
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
    if (patch.status !== undefined || patch.checks !== undefined || patch.summary !== undefined || patch.scope !== undefined || patch.error !== undefined) {
      const nextMeta: ReviewMetaSnapshot = {
        status: this.state.status,
        checks: this.state.checks,
        summary: this.state.summary,
        scope: this.state.scope,
        error: this.state.error,
      }
      if (nextMeta.status !== this.meta.status || nextMeta.checks !== this.meta.checks
        || nextMeta.summary !== this.meta.summary || nextMeta.scope !== this.meta.scope || nextMeta.error !== this.meta.error) {
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

  private async loadDiff(path: string, revalidate: boolean): Promise<void> {
    const current = this.state.entries[path]
    if (current === undefined || current.fetching) return
    if (revalidate ? current.cache.kind !== 'ready' : (current.cache.kind !== 'empty' && current.cache.kind !== 'error')) return
    const generation = this.generation
    const scope = this.state.scope
    this.setEntry(path, entry => ({
      ...entry,
      fetching: true,
      // A revalidate keeps the cached content visible until it resolves.
      ...(revalidate ? {} : { cache: { kind: 'loading' } as const }),
    }))
    try {
      const wire = await this.remote.review.diff(this.sessionId, path, scope)
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) throw new Error(wire.value.message)
      const result = wire.value
      if (this.disposed || generation !== this.generation || this.state.entries[path] === undefined) return
      // Identical wire content keeps the previous parse object, so a no-op
      // revalidate costs no re-render inside the panel.
      const previous = this.state.entries[path]?.cache
      const cache: ReadyCache = previous !== undefined && previous.kind === 'ready' && sameDiffResult(previous.raw, result)
        ? previous
        : { kind: 'ready', ...parseDiffResult(result), raw: result }
      this.setEntry(path, entry => ({ ...entry, fetching: false, cache, stale: false }))
      const evicted = evictCollapsedCaches(this.state.entries, this.resident, this.cacheLimit, this.cacheBytes)
      if (evicted !== null) this.replaceEntries(evicted)
    } catch (reason) {
      if (this.disposed) return
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
    this.queues = { focus: [], viewport: [], idle: [] }
    this.queued.clear()
  }

  private prefetchIdle(): void {
    if (!this.visible) return
    const paths = this.state.status?.files.slice(0, REVIEW_IDLE_PREFETCH_LIMIT).map(file => file.path) ?? []
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
    void this.drain()
  }

  private takeNext(): string | undefined {
    for (const priority of ['focus', 'viewport', 'idle'] as const) {
      while (this.queues[priority].length > 0) {
        const path = this.queues[priority].shift()
        if (path === undefined || this.queued.get(path) !== priority) continue
        this.queued.delete(path)
        return path
      }
    }
    return undefined
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (!this.disposed) {
        const path = this.takeNext()
        if (path === undefined) break
        const entry = this.state.entries[path]
        if (entry === undefined) continue
        if (entry.cache.kind === 'empty' || entry.cache.kind === 'error') await this.loadDiff(path, false)
        else if (entry.cache.kind === 'ready' && entry.stale) await this.loadDiff(path, true)
        // A completed load parses and warms synchronously; yield between
        // files so a fast local RPC never turns the prefetch into one long
        // main-thread block.
        await new Promise(resolve => { setTimeout(resolve, 0) })
      }
    } finally {
      this.draining = false
    }
  }

  private async refreshSummary(sequence: number, scope: ReviewScope): Promise<void> {
    try {
      const wire = await this.remote.review.summary(this.sessionId, scope)
      if (!wire.ok || !wire.value.ok || sequence !== this.generation || this.disposed) return
      if (!sameSummary(this.state.summary, wire.value)) this.publish({ summary: wire.value })
    } catch {
      // Older Hosts do not expose summary. Ready file caches progressively
      // provide the same totals without surfacing a compatibility error.
    }
  }

  async refresh(options: { focusPath?: string; runChecks?: boolean; silent?: boolean } = {}): Promise<ReviewRefreshOutcome> {
    const { focusPath, runChecks = false, silent = false } = options
    const seq = ++this.generation
    try {
      const statusWire = await this.remote.review.status(this.sessionId, this.state.scope)
      if (!statusWire.ok) throw transportError(statusWire)
      if (!statusWire.value.ok) throw new Error(statusWire.value.message)
      let nextChecks: ChecksOk | null = null
      if (runChecks) {
        const checksWire = await this.remote.review.checks(this.sessionId)
        if (!checksWire.ok) throw transportError(checksWire)
        if (!checksWire.value.ok) throw new Error(checksWire.value.message)
        nextChecks = checksWire.value
      }
      if (seq !== this.generation || this.disposed) return { kind: 'superseded' }
      const nextStatus = statusWire.value
      const merged = mergeFileEntries(this.state.entries, nextStatus.files, () => ++this.stamp)
      const keepSummary = sameStatusFiles(this.state.status, nextStatus)
      let focus: string | undefined
      if (focusPath !== undefined) focus = matchReviewFile(nextStatus.files, focusPath)
      this.publish({
        status: nextStatus,
        ...(keepSummary ? {} : { summary: null }),
        entries: merged,
        ...(nextChecks !== null ? { checks: nextChecks } : {}),
        error: null,
      })
      void this.refreshSummary(seq, this.state.scope)
      void this.refreshHistory(true)
      // A reveal focus wants the current content immediately; everything
      // else (new or stale) flows through the sequential background queue.
      if (focus !== undefined) this.ensure(focus, 'focus', true)
      this.prefetchIdle()
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
        void this.refresh({ silent: true })
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
      else this.checksPending = true
    }
  }
}
