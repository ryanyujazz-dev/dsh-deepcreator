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
  ReviewChecksResult, ReviewHistoryResult, ReviewScope, ReviewStatusResult, ReviewUndoTurnResult,
} from '@ryanyujazz/dsh-review/types'
import {
  REVIEW_CACHE_LIMIT, REVIEW_PREFETCH_LIMIT, decodeMutationSignal, encodeMutationSignal,
  evictCollapsedCaches, markStale, matchReviewFile, mergeFileEntries, mutationSignal,
  parseDiffResult, sameDiffResult, type FileEntries, type FileEntry, type MutationSignal, type ReadyCache,
} from './review-model.ts'

type StatusOk = Extract<ReviewStatusResult, { ok: true }>
type ChecksOk = Extract<ReviewChecksResult, { ok: true }>
type HistoryOk = Extract<ReviewHistoryResult, { ok: true }>

/** The immutable view the panel renders through useSyncExternalStore. */
export interface ReviewCacheSnapshot {
  status: StatusOk | null
  checks: ChecksOk | null
  history: HistoryOk | null
  scope: ReviewScope
  entries: Readonly<FileEntries>
  /** Manual-refresh error surface; background failures stay silent. */
  error: string | null
}

/** A focused refresh must not confuse cancellation or transport failure with a real miss. */
export type ReviewRefreshOutcome =
  | { kind: 'ready' }
  | { kind: 'found'; path: string }
  | { kind: 'missing' }
  | { kind: 'superseded' }
  | { kind: 'error'; message: string }

const EMPTY_SNAPSHOT: ReviewCacheSnapshot = {
  status: null, checks: null, history: null, scope: 'uncommitted', entries: {}, error: null,
}

/** Settled mutation tools are coalesced into one invalidation after this long. */
const MUTATION_DEBOUNCE_MS = 600

function transportError(result: { ok: false; error: { message: string } }): Error {
  return new Error(result.error.message)
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

  private state = EMPTY_SNAPSHOT
  private listeners = new Set<() => void>()
  private generation = 0
  private stamp = 0
  private disposed = false
  private queue: string[] = []
  private draining = false
  private queued = new Set<string>()
  private expanded: ReadonlySet<string> = new Set()
  private visible = true
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
  }) {
    this.remote = options.remote
    this.sessionId = options.sessionId
    this.session = options.session
    this.prefetchLimit = options.prefetchLimit ?? REVIEW_PREFETCH_LIMIT
    this.cacheLimit = options.cacheLimit ?? REVIEW_CACHE_LIMIT
    // Seed the event baselines from the current snapshot: history that
    // predates this controller must not fire an invalidation.
    const initial = options.session.getSnapshot()
    this.seenMutations = decodeMutationSignal(encodeMutationSignal(mutationSignal(initial.nodes)))
    this.seenTurnEnds = initial.turnEnds.size
    this.unsubscribeSession = options.session.subscribe(() => { this.onSessionSnapshot() })
    void this.refresh()
    if (typeof window !== 'undefined') {
      this.historyTimer = window.setInterval(() => {
        if (!this.disposed && document.visibilityState === 'visible') void this.refreshHistory(true, true)
      }, 2_000)
      window.addEventListener('focus', this.onWindowFocus)
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  readonly getSnapshot = (): ReviewCacheSnapshot => this.state

  async selectScope(scope: ReviewScope, focusPath?: string): Promise<ReviewRefreshOutcome> {
    const same = JSON.stringify(scope) === JSON.stringify(this.state.scope)
    if (!same) {
      this.queue = []
      this.queued.clear()
      this.publish({ scope, status: null, entries: {}, error: null })
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
        const clearCompletedTurn = selectedTurn !== undefined && selectedTurn.remainingFiles === 0
        if (clearCompletedTurn) {
          // Drop historical source/patch caches as soon as reconciliation says
          // the selected turn is fully resolved. The completed history record
          // remains available to gray its conversation card.
          this.generation += 1
          this.queue = []
          this.queued.clear()
          this.publish({
            history,
            scope: 'uncommitted',
            status: null,
            entries: {},
            ...(silent ? {} : { error: null }),
          })
          void this.refresh({ silent: true })
        } else {
          this.publish({ history, ...(silent ? {} : { error: null }) })
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
    const missing = history.turns.flatMap(turn => turn.remainingFiles === 0
      ? []
      : turn.files
        .filter(file => file.additions === undefined || file.deletions === undefined)
        .map(file => ({ turn: turn.turn, path: file.path })))
    if (missing.length === 0) return
    this.turnStatsLoading = true
    try {
      for (const file of missing) {
        if (this.disposed) return
        const wire = await this.remote.review.diff(this.sessionId, file.path, { turn: file.turn })
        if (!wire.ok || !wire.value.ok) continue
        const parsed = parseDiffResult(wire.value)
        this.turnStats.set(this.turnStatsKey(file.turn, file.path), {
          additions: parsed.added,
          deletions: parsed.removed,
        })
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
  async resolveTurnFile(turn: number, path: string): Promise<'pending' | 'resolved'> {
    await this.refreshHistory(true)
    const record = this.state.history?.turns.find(item => item.turn === turn)
    const normalized = path.replaceAll('\\', '/')
    const turnFile = record?.files.find(file => {
      const candidates = [file.path, file.oldPath].filter((item): item is string => item !== undefined)
      return candidates.some(candidate => normalized === candidate || normalized.endsWith(`/${candidate}`))
    })
    return turnFile?.state === 'pending' ? 'pending' : 'resolved'
  }

  /** Panel expansion share: exempt from cache eviction. */
  setExpanded(paths: ReadonlySet<string>): void {
    this.expanded = paths
  }

  /** Panel visibility: the hidden→visible edge is the catch-all refresh. */
  setVisible(visible: boolean): void {
    const was = this.visible
    this.visible = visible
    if (visible && !was) {
      const runChecks = this.checksPending
      this.checksPending = false
      void this.refresh({ silent: true, runChecks })
    }
  }

  /** User gesture on one file: fetch or revalidate it now, ahead of the queue. */
  ensure(path: string, fresh = false): void {
    const entry = this.state.entries[path]
    if (entry === undefined || entry.fetching) return
    if (entry.cache.kind === 'ready') {
      if (fresh || entry.stale) void this.loadDiff(path, true)
      return
    }
    if (entry.cache.kind === 'empty' || entry.cache.kind === 'error') void this.loadDiff(path, false)
  }

  /**
   * Batch gesture (expand-all, expansion restore): every not-ready or stale
   * entry fetches through the sequential queue instead of firing N concurrent
   * fetches — the parse-and-warm tail of a burst of responses would each block
   * the main thread in a row. Ready, current entries need nothing.
   */
  loadAll(paths: Iterable<string>): void {
    const needs: string[] = []
    for (const path of paths) {
      const entry = this.state.entries[path]
      if (entry === undefined || entry.fetching) continue
      if (entry.cache.kind === 'empty' || entry.cache.kind === 'error' || (entry.cache.kind === 'ready' && entry.stale)) needs.push(path)
    }
    this.enqueue(needs)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.invalidateTimer !== null) window.clearTimeout(this.invalidateTimer)
    if (this.historyTimer !== null) window.clearInterval(this.historyTimer)
    if (typeof window !== 'undefined') window.removeEventListener('focus', this.onWindowFocus)
    this.unsubscribeSession()
    this.listeners.clear()
  }

  private publish(patch: Partial<ReviewCacheSnapshot>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private setEntry(path: string, mutate: (entry: FileEntry) => FileEntry): void {
    const existing = this.state.entries[path]
    if (existing === undefined) return
    this.publish({ entries: { ...this.state.entries, [path]: mutate(existing) } })
  }

  private async loadDiff(path: string, revalidate: boolean): Promise<void> {
    const current = this.state.entries[path]
    if (current === undefined || current.fetching) return
    if (revalidate ? current.cache.kind !== 'ready' : (current.cache.kind !== 'empty' && current.cache.kind !== 'error')) return
    this.setEntry(path, entry => ({
      ...entry,
      fetching: true,
      // A revalidate keeps the cached content visible until it resolves.
      ...(revalidate ? {} : { cache: { kind: 'loading' } as const }),
    }))
    try {
      const wire = await this.remote.review.diff(this.sessionId, path, this.state.scope)
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) throw new Error(wire.value.message)
      const result = wire.value
      if (this.disposed || this.state.entries[path] === undefined) return
      // Identical wire content keeps the previous parse object, so a no-op
      // revalidate costs no re-render inside the panel.
      const previous = this.state.entries[path]?.cache
      const cache: ReadyCache = previous !== undefined && previous.kind === 'ready' && sameDiffResult(previous.raw, result)
        ? previous
        : { kind: 'ready', ...parseDiffResult(result), raw: result }
      this.setEntry(path, entry => ({ ...entry, fetching: false, cache, stale: false }))
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

  /** Append paths to the sequential background queue (in order, deduped). */
  private enqueue(paths: Iterable<string>): void {
    for (const path of paths) {
      if (this.queued.has(path)) continue
      if (this.queue.length >= this.prefetchLimit) break
      this.queued.add(path)
      this.queue.push(path)
    }
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (!this.disposed) {
        const path = this.queue.shift()
        if (path === undefined) break
        this.queued.delete(path)
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
      let focus: string | undefined
      if (focusPath !== undefined) focus = matchReviewFile(nextStatus.files, focusPath)
      this.publish({
        status: nextStatus,
        entries: merged,
        ...(nextChecks !== null ? { checks: nextChecks } : {}),
        error: null,
      })
      void this.refreshHistory(true)
      // A reveal focus wants the current content immediately; everything
      // else (new or stale) flows through the sequential background queue.
      if (focus !== undefined) this.ensure(focus, true)
      this.enqueue(nextStatus.files
        .map(file => file.path)
        .filter(path => {
          const entry = merged[path]
          return entry !== undefined && (entry.cache.kind === 'empty' || (entry.cache.kind === 'ready' && entry.stale))
        }))
      const evicted = evictCollapsedCaches(merged, this.expanded, this.cacheLimit)
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
