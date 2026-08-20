import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, RefObject } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@ryanyujazz/dsh-review/remote'
import type { ReviewFileStatus, ReviewFileSummary, ReviewScope } from '@ryanyujazz/dsh-review/types'
import type { TerminalSessionView } from '@ryanyujazz/dsh-terminal-workbench/types'
import type {} from '@ryanyujazz/dsh-terminal-workbench/remote'
import type {
  WorkbenchPanelHeaderContribution, WorkbenchPanelInfoContribution, WorkbenchPanelProps,
} from '@ryanyujazz/dsh-client-ui-workbench/client'
import {
  DiffBlock, FileIcon, IconChevronDownOutline14, IconPlusOutline16, IconRefreshOutline14, IconUnfoldLessOutline16,
  IconUnfoldMoreOutline16, Menu, OverflowFadeText, WorkbenchPanelIconButton, type MenuEntry,
} from '@ryanyujazz/dsh-client-ui-primitives'
import { REVIEW_IDLE_PREFETCH_LIMIT } from './review-model.ts'
import type { ReviewCacheController } from './review-cache.ts'
import css from './Panels.module.css'
import { TerminalEmulator } from './TerminalEmulator.tsx'

export { matchReviewFile } from './review-model.ts'

type Props = WorkbenchPanelProps & PropsLocale<'workbench-tools'>
type RemoteProps = Props & { remote: TypertClientRemote }
type TerminalProps = Props & { terminal: TypertClientRemote['terminal-workbench'] }

interface DesktopBrowserBridge {
  create(id: string, url: string, bounds: DOMRectLike): Promise<unknown>
  navigate(id: string, url: string): Promise<unknown>
  back(id: string): Promise<void>
  forward(id: string): Promise<void>
  reload(id: string): Promise<void>
  setBounds(id: string, bounds: DOMRectLike): Promise<void>
  close(id: string): Promise<void>
  onState(listener: (state: { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }) => void): () => void
  onPopup(listener: (popup: { sourceId: string; url: string }) => void): () => void
}
interface DOMRectLike { x: number; y: number; width: number; height: number }
declare global { interface Window { deepcreatorBrowser?: DesktopBrowserBridge } }

function Empty({ title, body }: { title: string; body: string }) {
  return <div className={css.empty}><strong>{title}</strong><span>{body}</span></div>
}

function transportError(result: { ok: false; error: { message: string } }): Error {
  return new Error(result.error.message)
}

/** Last path segment of a session cwd, e.g. the project folder name. */
function cwdProjectName(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd === '') return undefined
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
  return base === undefined || base === '' ? undefined : base
}

/**
 * Terminal tabs are named after each PTY's working-directory project folder;
 * duplicates get a counter and sessions without a cwd fall back to the shell
 * label, then to the session id.
 */
export function terminalTabLabels(sessions: readonly TerminalSessionView[]): Record<string, string> {
  const counts = new Map<string, number>()
  const labels: Record<string, string> = {}
  for (const session of sessions) {
    const base = cwdProjectName(session.cwd) ?? session.shell ?? session.sessionId
    const seen = (counts.get(base) ?? 0) + 1
    counts.set(base, seen)
    labels[session.sessionId] = seen === 1 ? base : `${base} ${seen}`
  }
  return labels
}

function usePanelHeaderActions(
  contribute: (contribution: WorkbenchPanelHeaderContribution) => () => void,
  contribution: WorkbenchPanelHeaderContribution,
) {
  useEffect(() => contribute(contribution), [contribute, contribution])
}

/** Heavy Diff bodies retained at rest; intersecting/focused rows may exceed it. */
export const REVIEW_BODY_RESIDENT_LIMIT = 16

/** Each successful boundary load unlocks roughly this much vertical content. */
export const REVIEW_UNLOCK_SCREENS = 2

/** Used only before the Workbench scroll viewport has a measurable height. */
const REVIEW_FALLBACK_VIEWPORT_HEIGHT = 720

/** A frame gap above this means scrolling paused; heavy bodies fill then. */
const BODY_FILL_IDLE_MS = 120

/**
 * One heavy body per frame, only when scrolling pauses. Batch-expanded files
 * mount a light skeleton as they enter the viewport (scrolling stays on the
 * compositor); the real DiffBlock mounts through this queue once scroll
 * activity has been quiet for a pause window, one per frame, so a fast scroll
 * never waits on a burst of heavy commits.
 */
interface BodyFillTask { fill: () => void; cancelled: boolean }
const bodyFillQueue: BodyFillTask[] = []
let bodyFillFrame: number | null = null
/** After this timestamp with no scroll activity, bodies may fill. */
let bodyFillIdleAt = 0
let scrollListening = false

function onScrollCapture(): void {
  bodyFillIdleAt = performance.now() + BODY_FILL_IDLE_MS
}

function requestBodyFill(fill: () => void): () => void {
  // jsdom (and other hosts without rAF) fills synchronously: tests observe
  // the fully mounted body without frame machinery.
  if (typeof requestAnimationFrame === 'undefined') { fill(); return () => undefined }
  if (!scrollListening && typeof window !== 'undefined') {
    scrollListening = true
    window.addEventListener('scroll', onScrollCapture, true)
  }
  const task: BodyFillTask = { fill, cancelled: false }
  bodyFillQueue.push(task)
  bodyFillIdleAt = performance.now() + BODY_FILL_IDLE_MS
  if (bodyFillFrame === null) {
    bodyFillFrame = requestAnimationFrame(tickBodyFill)
  }
  return () => { task.cancelled = true }
}

function tickBodyFill(now: number): void {
  bodyFillFrame = null
  if (now < bodyFillIdleAt) {
    // Scrolling (or a fresh request) is still active: wait it out.
    bodyFillFrame = requestAnimationFrame(tickBodyFill)
    return
  }
  let task = bodyFillQueue.shift()
  while (task?.cancelled === true) task = bodyFillQueue.shift()
  if (task === undefined) return
  task.fill()
  if (bodyFillQueue.length > 0) {
    // One heavy commit per frame, then breathe before the next.
    bodyFillIdleAt = now + 40
    bodyFillFrame = requestAnimationFrame(tickBodyFill)
  }
}

type ReviewPanelProps = WorkbenchPanelProps & PropsLocale<'workbench-tools'> & { controller: ReviewCacheController }
const EMPTY_REVIEW_FILES: readonly ReviewFileStatus[] = []
const EMPTY_FOLD_KEYS: ReadonlySet<string> = new Set()

function scrollingParent(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null
  while (current !== null) {
    const overflow = getComputedStyle(current).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return current
    current = current.parentElement
  }
  return null
}

function useReviewResidency(options: {
  controller: ReviewCacheController
  files: readonly ReviewFileStatus[]
  expanded: ReadonlySet<string>
  eagerPath: string | null
  listRef: RefObject<HTMLDivElement | null>
}) {
  const { controller, files, expanded, eagerPath, listRef } = options
  const [resident, setResident] = useState<ReadonlySet<string>>(new Set())
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null)
  const [widthBucket, setWidthBucket] = useState(0)
  const expandedRef = useRef(expanded); expandedRef.current = expanded
  const eagerRef = useRef(eagerPath); eagerRef.current = eagerPath
  const near = useRef(new Set<string>())
  const stamps = useRef(new Map<string, number>())
  const stamp = useRef(0)
  const releaseTimers = useRef(new Map<string, number>())
  const scheduled = useRef(new Map<string, () => void>())

  const hydrate = useCallback((path: string, immediate = false) => {
    if (!expandedRef.current.has(path)) return
    const timer = releaseTimers.current.get(path)
    if (timer !== undefined) { window.clearTimeout(timer); releaseTimers.current.delete(path) }
    controller.ensure(path, immediate ? 'focus' : 'viewport')
    const commit = () => {
      if (!expandedRef.current.has(path) || (!immediate && !near.current.has(path))) return
      stamps.current.set(path, ++stamp.current)
      setResident(current => {
        const next = new Set(current); next.add(path)
        if (next.size > REVIEW_BODY_RESIDENT_LIMIT) {
          const removable = [...next]
            .filter(candidate => !near.current.has(candidate) && candidate !== eagerRef.current)
            .toSorted((left, right) => (stamps.current.get(left) ?? 0) - (stamps.current.get(right) ?? 0))
          while (next.size > REVIEW_BODY_RESIDENT_LIMIT && removable.length > 0) {
            const candidate = removable.shift()
            if (candidate !== undefined) next.delete(candidate)
          }
        }
        return next
      })
    }
    if (immediate) {
      scheduled.current.get(path)?.()
      scheduled.current.delete(path)
      commit()
    } else if (!scheduled.current.has(path)) {
      const cancel = requestBodyFill(() => { scheduled.current.delete(path); commit() })
      scheduled.current.set(path, cancel)
    }
  }, [controller])

  useEffect(() => {
    const list = listRef.current
    if (list === null || files.length === 0) return
    const root = scrollingParent(list)
    setScrollRoot(root)
    const updateWidth = () => { setWidthBucket(Math.round((root?.clientWidth ?? list.clientWidth) / 32)) }
    updateWidth()
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth)
    resize?.observe(root ?? list)
    const rows = [...list.querySelectorAll<HTMLElement>('[data-review-path]')]
    if (typeof IntersectionObserver === 'undefined') {
      for (const row of rows.slice(0, REVIEW_IDLE_PREFETCH_LIMIT)) {
        const path = row.dataset.reviewPath ?? ''
        near.current.add(path)
        hydrate(path)
      }
      return () => { resize?.disconnect() }
    }
    const hydration = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const path = (entry.target as HTMLElement).dataset.reviewPath
        if (path === undefined) continue
        if (entry.isIntersecting) { near.current.add(path); hydrate(path) }
        else {
          near.current.delete(path)
          scheduled.current.get(path)?.()
          scheduled.current.delete(path)
        }
      }
    }, { root, rootMargin: '200% 0px' })
    const retention = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const path = (entry.target as HTMLElement).dataset.reviewPath
        if (path === undefined) continue
        const existing = releaseTimers.current.get(path)
        if (entry.isIntersecting) {
          if (existing !== undefined) { window.clearTimeout(existing); releaseTimers.current.delete(path) }
          continue
        }
        if (existing !== undefined || path === eagerRef.current) continue
        const timer = window.setTimeout(() => {
          releaseTimers.current.delete(path)
          if (near.current.has(path) || path === eagerRef.current) return
          setResident(current => {
            if (!current.has(path)) return current
            const next = new Set(current); next.delete(path); return next
          })
        }, 500)
        releaseTimers.current.set(path, timer)
      }
    }, { root, rootMargin: '300% 0px' })
    for (const row of rows) { hydration.observe(row); retention.observe(row) }
    return () => {
      hydration.disconnect(); retention.disconnect(); resize?.disconnect()
      for (const timer of releaseTimers.current.values()) window.clearTimeout(timer)
      releaseTimers.current.clear()
      for (const cancel of scheduled.current.values()) cancel()
      scheduled.current.clear()
    }
  }, [files, hydrate, listRef])

  useEffect(() => {
    if (eagerPath !== null) hydrate(eagerPath, true)
  }, [eagerPath, hydrate])

  useEffect(() => {
    const mounted = new Set(files.map(file => file.path))
    for (const path of near.current) if (!mounted.has(path)) near.current.delete(path)
    setResident(current => {
      const next = new Set([...current].filter(path => mounted.has(path)))
      return next.size === current.size ? current : next
    })
  }, [files])

  useEffect(() => {
    for (const path of near.current) if (expanded.has(path)) hydrate(path)
    setResident(current => {
      const next = new Set([...current].filter(path => expanded.has(path)))
      return next.size === current.size ? current : next
    })
  }, [expanded])

  useEffect(() => { controller.setResident(resident) }, [controller, resident])
  return { resident, scrollRoot, widthBucket }
}

function reviewRowEstimate(summary: ReviewFileSummary | undefined, expanded: boolean): number {
  if (!expanded) return 36
  if (summary?.binary === true) return 156
  const changed = (summary?.additions ?? 1) + (summary?.deletions ?? 1)
  const context = Math.min(18, Math.max(6, Math.ceil(changed * 0.6)))
  return 36 + Math.max(120, Math.min((changed + context) * 20 + 40, 600))
}

function reviewFileSettled(controller: ReviewCacheController, path: string): boolean {
  const kind = controller.getFileSnapshot(path)?.cache.kind
  return kind === 'ready' || kind === 'error'
}

/**
 * Keep the scroll range bounded by prepared content. The first six rows are
 * visible immediately; reaching the sentinel prepares a complete ~2-screen
 * batch off-DOM and unlocks it atomically. A focused reveal recenters the
 * window on its target and then grows through independent before/after gates,
 * so direct navigation never waits on every file that precedes it.
 */
function useReviewProgressiveGate(options: {
  controller: ReviewCacheController
  files: readonly ReviewFileStatus[]
  summaries: ReadonlyMap<string, ReviewFileSummary>
  expanded: ReadonlySet<string>
  eagerPath: string | null
  listRef: RefObject<HTMLDivElement | null>
  scopeKey: string
}) {
  const { controller, files, summaries, expanded, eagerPath, listRef, scopeKey } = options
  const [unlockedStart, setUnlockedStart] = useState(0)
  const [unlockedEnd, setUnlockedEnd] = useState(() => Math.min(REVIEW_IDLE_PREFETCH_LIMIT, files.length))
  const [pendingBefore, setPendingBefore] = useState<number | null>(null)
  const [pendingAfter, setPendingAfter] = useState<number | null>(null)
  const [rangeSettled, setRangeSettled] = useState(false)
  const beforeSentinelRef = useRef<HTMLDivElement | null>(null)
  const afterSentinelRef = useRef<HTMLDivElement | null>(null)
  const previousScope = useRef(scopeKey)

  useEffect(() => {
    if (previousScope.current !== scopeKey) {
      previousScope.current = scopeKey
      setUnlockedStart(0)
      setUnlockedEnd(Math.min(REVIEW_IDLE_PREFETCH_LIMIT, files.length))
      setPendingBefore(null)
      setPendingAfter(null)
      setRangeSettled(false)
      return
    }
    setUnlockedStart(current => Math.min(current, Math.max(0, files.length - 1)))
    setUnlockedEnd(current => Math.min(files.length, Math.max(Math.min(REVIEW_IDLE_PREFETCH_LIMIT, files.length), current)))
  }, [files, scopeKey])

  useEffect(() => {
    if (eagerPath === null) return
    const index = files.findIndex(file => file.path === eagerPath)
    if (index < 0 || (index >= unlockedStart && index < unlockedEnd)) return
    // A direct reveal starts a fresh one-file window. Once the focused body is
    // ready, the independent before/after sentinels unlock two screens in
    // either direction without fetching every intervening path.
    setUnlockedStart(index)
    setUnlockedEnd(index + 1)
    setPendingBefore(null)
    setPendingAfter(null)
    setRangeSettled(false)
  }, [eagerPath, files, unlockedEnd, unlockedStart])

  const range = useMemo(() => files.slice(unlockedStart, unlockedEnd), [files, unlockedEnd, unlockedStart])
  const rangeKey = useMemo(() => range.map(file => file.path).join('\n'), [range])
  useEffect(() => {
    const paths = range.map(file => file.path)
    const check = () => { setRangeSettled(paths.every(path => reviewFileSettled(controller, path))) }
    const off = paths.map(path => controller.subscribeFile(path, check))
    check()
    return () => { for (const unsubscribe of off) unsubscribe() }
  }, [controller, rangeKey])

  useEffect(() => {
    if (pendingBefore === null) return
    const paths = files.slice(pendingBefore, unlockedStart).map(file => file.path)
    const check = () => {
      if (!paths.every(path => reviewFileSettled(controller, path))) return
      setUnlockedStart(current => Math.min(current, pendingBefore))
      setPendingBefore(null)
    }
    const off = paths.map(path => controller.subscribeFile(path, check))
    check()
    return () => { for (const unsubscribe of off) unsubscribe() }
  }, [controller, files, pendingBefore, unlockedStart])

  useEffect(() => {
    if (pendingAfter === null) return
    const paths = files.slice(unlockedEnd, pendingAfter).map(file => file.path)
    const check = () => {
      if (!paths.every(path => reviewFileSettled(controller, path))) return
      setUnlockedEnd(current => Math.max(current, pendingAfter))
      setPendingAfter(null)
    }
    const off = paths.map(path => controller.subscribeFile(path, check))
    check()
    return () => { for (const unsubscribe of off) unsubscribe() }
  }, [controller, files, pendingAfter, unlockedEnd])

  const batchBudget = useCallback(() => {
    const root = scrollingParent(listRef.current)
    const measured = root?.clientHeight ?? 0
    const viewportHeight = measured > 0 ? measured : REVIEW_FALLBACK_VIEWPORT_HEIGHT
    return viewportHeight * REVIEW_UNLOCK_SCREENS
  }, [listRef])

  const beginBeforeBatch = useCallback(() => {
    if (!rangeSettled || pendingBefore !== null || unlockedStart <= 0) return
    let height = 0
    let start = unlockedStart
    const budget = batchBudget()
    while (start > 0 && (height < budget || start === unlockedStart)) {
      const file = files[start - 1]
      if (file === undefined) break
      height += reviewRowEstimate(summaries.get(file.path), expanded.has(file.path))
      start -= 1
    }
    if (start === unlockedStart) return
    setPendingBefore(start)
    for (const file of files.slice(start, unlockedStart)) controller.ensure(file.path, 'viewport')
  }, [batchBudget, controller, expanded, files, pendingBefore, rangeSettled, summaries, unlockedStart])

  const beginAfterBatch = useCallback(() => {
    if (!rangeSettled || pendingAfter !== null || unlockedEnd >= files.length) return
    let height = 0
    let end = unlockedEnd
    const budget = batchBudget()
    while (end < files.length && (height < budget || end === unlockedEnd)) {
      const file = files[end]
      if (file === undefined) break
      height += reviewRowEstimate(summaries.get(file.path), expanded.has(file.path))
      end += 1
    }
    if (end === unlockedEnd) return
    setPendingAfter(end)
    for (const file of files.slice(unlockedEnd, end)) controller.ensure(file.path, 'viewport')
  }, [batchBudget, controller, expanded, files, pendingAfter, rangeSettled, summaries, unlockedEnd])

  useEffect(() => {
    const sentinel = beforeSentinelRef.current
    if (sentinel === null || unlockedStart <= 0 || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) beginBeforeBatch()
    }, { root: scrollingParent(listRef.current), rootMargin: '200% 0px 0px 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [beginBeforeBatch, listRef, unlockedStart])

  useEffect(() => {
    const sentinel = afterSentinelRef.current
    if (sentinel === null || unlockedEnd >= files.length || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) beginAfterBatch()
    }, { root: scrollingParent(listRef.current), rootMargin: '0px 0px 200% 0px' })
    observer.observe(sentinel)
    return () => { observer.disconnect() }
  }, [beginAfterBatch, files.length, listRef, unlockedEnd])

  return {
    files: range,
    beforeSentinelRef,
    afterSentinelRef,
    hasBeforeBoundary: unlockedStart > 0,
    hasAfterBoundary: unlockedEnd < files.length,
  }
}

/**
 * One file row: header + expanded body. All props are stable references
 * (the merge keeps unchanged entries' identity), so one entry's fetch or
 * revalidate re-renders only its own row and the parse-once layer objects
 * keep DiffBlock's internal diff/highlight memos alive.
 *
 * Mounting is two-stage so scrolling never waits on heavy work. Approaching
 * the viewport mounts a light skeleton (an estimated-height box, ~1 ms);
 * the real DiffBlock mounts either immediately for a single-file expand
 * gesture, or through the pause-detecting body-fill queue after a batch
 * expand-all. Far bodies unmount behind an equal-height placeholder while
 * their logical expansion and controlled fold state remain intact.
 */
const ReviewFileRow = memo(function ReviewFileRow({
  file, summary, controller, expanded, resident, scrollRoot, widthBucket, onToggle, t,
}: {
  file: ReviewFileStatus
  summary: ReviewFileSummary | undefined
  controller: ReviewCacheController
  expanded: boolean
  resident: boolean
  scrollRoot: HTMLElement | null
  widthBucket: number
  onToggle: (path: string) => void
  t: RemoteProps['t']
}) {
  const subscribe = useCallback((listener: () => void) => controller.subscribeFile(file.path, listener), [controller, file.path])
  const getSnapshot = useCallback(() => controller.getFileSnapshot(file.path), [controller, file.path])
  const entry = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (entry === undefined) throw new Error(`Review entry is missing for ${file.path}`)
  const ready = entry.cache.kind === 'ready' ? entry.cache : null
  // Parent-driven fold control, scoped per layer: each layer's DiffBlocks
  // report their expanded-fold counts, the layer title bar grows a re-fold
  // button on its trailing edge once any fold in that layer is open, and one
  // click re-folds that layer's hunks and gaps only.
  const [foldSignals, setFoldSignals] = useState<Record<string, number>>({})
  const [layerFolds, setLayerFolds] = useState<Record<string, number>>({})
  const [expandedFoldKeys, setExpandedFoldKeys] = useState<Record<string, ReadonlySet<string>>>({})
  const foldCounts = useRef(new Map<string, number>())
  const onFoldState = useCallback((layer: string, key: string, count: number) => {
    foldCounts.current.set(`${layer}:${key}`, count)
    setLayerFolds(current => {
      let sum = 0
      for (const [mapKey, value] of foldCounts.current) {
        if (mapKey.startsWith(`${layer}:`)) sum += value
      }
      return { ...current, [layer]: sum }
    })
  }, [])
  const layerRefold = useCallback((layer: string) => {
    setFoldSignals(current => ({ ...current, [layer]: (current[layer] ?? 0) + 1 }))
    setExpandedFoldKeys(current => Object.fromEntries(
      Object.entries(current).map(([key, value]) => [key, key.startsWith(`${layer}:`) ? EMPTY_FOLD_KEYS : value]),
    ))
    for (const mapKey of [...foldCounts.current.keys()]) {
      if (mapKey.startsWith(`${layer}:`)) foldCounts.current.delete(mapKey)
    }
    setLayerFolds(current => ({ ...current, [layer]: 0 }))
  }, [])
  const foldReporters = useRef(new Map<string, (count: number) => void>())
  const foldReporterFor = useCallback((layer: string, key: string): (count: number) => void => {
    const cacheKey = `${layer}:${key}`
    let reporter = foldReporters.current.get(cacheKey)
    if (reporter === undefined) {
      reporter = (count: number) => { onFoldState(layer, key, count) }
      foldReporters.current.set(cacheKey, reporter)
    }
    return reporter
  }, [onFoldState])
  const pending = entry.cache.kind === 'loading' || entry.cache.kind === 'empty'
  const failed = entry.cache.kind === 'error' ? entry.cache.message : null
  const oldPath = ready?.raw.oldPath ?? file.oldPath
  const label = oldPath !== undefined && oldPath !== file.path ? `${oldPath} → ${file.path}` : file.path
  const anchorRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const measuredHeights = useRef(new Map<number, number>())
  const hunks = useMemo(() => ready?.layers.reduce((sum, layer) => sum + layer.files.reduce((files, parsed) => (
    files + (parsed.binary ? 0 : parsed.hunks.length)
  ), 0), 0) ?? 0, [ready])
  const estimate = Math.max(120, Math.min(hunks * 16 + 40, 600))
  const [bodyHeight, setBodyHeight] = useState(estimate)
  useEffect(() => { setBodyHeight(measuredHeights.current.get(widthBucket) ?? estimate) }, [estimate, widthBucket])
  useEffect(() => {
    const node = bodyRef.current
    if (!resident || !expanded || node === null || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = Math.max(1, Math.ceil(node.getBoundingClientRect().height))
      const previous = measuredHeights.current.get(widthBucket) ?? bodyHeight
      measuredHeights.current.set(widthBucket, next)
      if (next === bodyHeight) return
      const article = anchorRef.current
      if (scrollRoot !== null && article !== null && article.getBoundingClientRect().top < scrollRoot.getBoundingClientRect().top) {
        scrollRoot.scrollTop += next - previous
      }
      setBodyHeight(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [bodyHeight, expanded, resident, scrollRoot, widthBucket])

  const onHeaderClick = useCallback(() => {
    if (!expanded) controller.ensure(file.path, 'focus')
    onToggle(file.path)
  }, [controller, expanded, file.path, onToggle])
  const additions = summary?.additions ?? ready?.added
  const deletions = summary?.deletions ?? ready?.removed
  const showCounts = summary?.binary !== true && additions !== undefined && deletions !== undefined
  return (
    <article ref={anchorRef} className={css.reviewFile} data-review-path={file.path}>
      <button
        type="button"
        className={css.reviewFileHeader}
        aria-expanded={expanded}
        onClick={onHeaderClick}
      >
        <IconChevronDownOutline14 className={expanded ? undefined : css.reviewFileChevronCollapsed} />
        <FileIcon path={file.path} />
        <OverflowFadeText className={css.reviewFilePath} text={label} fade="left" />
        {pending && summary === undefined
          ? <span className={css.reviewFileLoading}>{t('loading')}</span>
          : showCounts && <span className={css.reviewCounts}><b>{`+${additions}`}</b><i>{`-${deletions}`}</i></span>}
      </button>
      {expanded && !resident && (
        <div className={css.reviewFileSkeleton} style={{ height: bodyHeight }} aria-hidden>
          {t('loading')}
        </div>
      )}
      {resident && expanded && (
        <div ref={bodyRef} className={css.reviewFileContent}>
          {pending && <div className={css.reviewFileMessage}>{t('loading')}</div>}
          {failed !== null && <div className={css.reviewFileError}>{failed}</div>}
          {ready !== null && ready.layers.map(layer => (
            <section key={layer.kind} className={css.diffLayer}>
              <div className={css.diffLayerTitle}>
                <span>{layer.kind === 'staged'
                  ? t('review.layer.staged')
                  : layer.kind === 'working-tree'
                    ? t('review.layer.working')
                    : layer.kind === 'turn'
                      ? t('review.layer.turn')
                      : t('review.layer.uncommitted')}</span>
                {(layerFolds[layer.kind] ?? 0) > 0 && (
                  <button
                    type="button"
                    className={css.layerRefold}
                    aria-label={t('review.refold')}
                    title={t('review.refold')}
                    onClick={() => { layerRefold(layer.kind) }}
                  >
                    <IconUnfoldLessOutline16 size={12} />
                  </button>
                )}
              </div>
              {layer.files.map(parsed => (
                parsed.binary
                  ? <div key={parsed.key} className={css.binary}>{t('review.binary')}</div>
                  : <DiffBlock
                    key={parsed.key}
                    diffs={parsed.hunks}
                    showPath={false}
                    showFooter={false}
                    variant="review"
                    foldResetSignal={foldSignals[layer.kind] ?? 0}
                    onFoldStateChange={foldReporterFor(layer.kind, parsed.key)}
                    expandedFoldKeys={expandedFoldKeys[`${layer.kind}:${parsed.key}`] ?? EMPTY_FOLD_KEYS}
                    onExpandedFoldKeysChange={keys => {
                      setExpandedFoldKeys(current => ({ ...current, [`${layer.kind}:${parsed.key}`]: keys }))
                    }}
                  />
              ))}
            </section>
          ))}
        </div>
      )}
    </article>
  )
})

function ReviewTotals({ controller }: { controller: ReviewCacheController }) {
  const totals = useSyncExternalStore(controller.subscribeTotals, controller.getTotalsSnapshot, controller.getTotalsSnapshot)
  if (totals.added === 0 && totals.removed === 0) return <>—</>
  return <span className={css.reviewCounts}><b>{`+${totals.added}`}</b><i>{`-${totals.removed}`}</i></span>
}

export function ReviewPanel({ controller, reveal, visible, contributeHeaderActions, t }: ReviewPanelProps) {
  const meta = useSyncExternalStore(controller.subscribeMeta, controller.getMetaSnapshot, controller.getMetaSnapshot)
  const history = useSyncExternalStore(controller.subscribeHistory, controller.getHistorySnapshot, controller.getHistorySnapshot)
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set())
  const [eagerPath, setEagerPath] = useState<string | null>(null)
  const [missedPath, setMissedPath] = useState<string | null>(null)
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const expandedRef = useRef(expandedPaths); expandedRef.current = expandedPaths
  const prevVisible = useRef(false)
  /** Whether the current open has already been handled (expand-all or reveal). */
  const openHandled = useRef(false)
  const files = meta.status?.files ?? EMPTY_REVIEW_FILES
  const summaries = useMemo(() => new Map(meta.summary?.files.map(file => [file.path, file]) ?? []), [meta.summary])
  const scopeId = typeof meta.scope === 'string' ? meta.scope : `turn:${meta.scope.turn}`
  const gate = useReviewProgressiveGate({
    controller, files, summaries, expanded: expandedPaths, eagerPath, listRef, scopeKey: scopeId,
  })
  const residency = useReviewResidency({ controller, files: gate.files, expanded: expandedPaths, eagerPath, listRef })

  // Opening the panel (first mount visible, or hidden→visible) means
  // expand-all with the list focused at the top — unless this open is driven
  // by a reveal command, which keeps its own expand-and-scroll behavior.
  useEffect(() => {
    const nowVisible = visible !== false
    const wasVisible = prevVisible.current
    prevVisible.current = nowVisible
    if (!nowVisible || wasVisible) return
    openHandled.current = reveal !== undefined
  }, [reveal, visible])

  // The expand-all above waits for the first status, then expands every file
  // and scrolls the list back to its top.
  useEffect(() => {
    if (openHandled.current || reveal !== undefined || !(visible !== false)) return
    const files = meta.status?.files ?? []
    if (files.length === 0) return
    openHandled.current = true
    const next = new Set(files.map(file => file.path))
    expandedRef.current = next
    startTransition(() => { setExpandedPaths(next) })
    // Focus the top after the expansion joins the layout.
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[data-review-path]')
        ?.scrollIntoView({ block: 'start' })
    })
  }, [meta.status, reveal, visible])

  // Publish the hidden→visible edge before processing its presentation. The
  // controller's visibility catch-all may start a status refresh; running it
  // first lets the explicit scope/reveal refresh supersede that generic one.
  // In the opposite order the catch-all could supersede selectScope and skip
  // its expand-all completion, leaving a random subset from the prior scope.
  useEffect(() => { controller.setVisible(visible !== false) }, [controller, visible])

  // A reveal expands and scrolls to the target: the optimistic pass points
  // at a cached file immediately, the silent refresh corrects and re-fetches
  // the focused file. The nonce (command sequence) makes same-path repeats
  // re-fire.
  useEffect(() => {
    if (reveal === undefined) return
    // A new reveal invalidates any previous miss immediately. Only a
    // completed status response is allowed to declare the new target absent.
    setMissedPath(null)
    const scopeValue = reveal.parameters?.scope
    const turnValue = reveal.parameters?.turn
    const turn = turnValue === undefined ? Number.NaN : Number(turnValue)
    const requested: ReviewScope = scopeValue === 'unstaged' || scopeValue === 'staged' || scopeValue === 'uncommitted'
      ? scopeValue
      : Number.isSafeInteger(turn) && turn >= 0 ? { turn } : meta.scope
    // Every Review presentation is expand-all by contract. Parameters still
    // spell it out for self-documenting entry points, but this provider-side
    // default prevents a future or fallback reveal from silently regressing.
    void controller.selectScope(requested, reveal.target).then((outcome) => {
      if (outcome.kind === 'missing') {
        if (reveal.target !== undefined) setMissedPath(reveal.target)
        return
      }
      if (outcome.kind === 'ready' || outcome.kind === 'found') {
        const paths = controller.getSnapshot().status?.files.map(file => file.path) ?? []
        const next = new Set(paths)
        expandedRef.current = next
        const focus = outcome.kind === 'found' ? outcome.path : null
        setEagerPath(focus)
        setExpandedPaths(next)
        requestAnimationFrame(() => {
          const rows = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-review-path]') ?? [])]
          const row = focus === null
            ? rows[0]
            : rows.find(node => node.dataset.reviewPath === focus)
          row?.scrollIntoView(focus === null ? { block: 'start' } : { behavior: 'smooth', block: 'start' })
          if (focus !== null) window.setTimeout(() => { setEagerPath(current => current === focus ? null : current) }, 500)
        })
      }
    }).catch(() => {
      // Reveal refresh failures keep the last good panel; the optimistic
      // expansion above already pointed the user at the file.
    })
  }, [reveal, controller])

  const toggleFile = useCallback((path: string): void => {
    const opening = !expandedRef.current.has(path)
    const next = new Set(expandedRef.current)
    if (opening) next.add(path)
    else next.delete(path)
    expandedRef.current = next
    setExpandedPaths(next)
    // SWR on expand: a stale cache displays immediately and revalidates.
    if (opening) {
      controller.ensure(path, 'focus')
      setEagerPath(path)
      window.setTimeout(() => { setEagerPath(current => current === path ? null : current) }, 500)
    }
  }, [controller])

  // One header action left of the refresh button: expand-all when nothing is
  // expanded, collapse-all otherwise — the icon states swap with the action.
  const anyExpanded = expandedPaths.size > 0
  const scopeLabel = typeof meta.scope === 'string'
    ? t(`review.scope.${meta.scope}`)
    : t('review.scope.turn', { turn: meta.scope.turn })
  const historyTurns = useMemo(() => history?.turns
    .filter(turn => turn.remainingFiles > 0)
    .toSorted((a, b) => b.turn - a.turn) ?? [], [history])
  const scopeItems = useMemo<MenuEntry[]>(() => [
    { id: 'unstaged', label: t('review.scope.unstaged') },
    { id: 'staged', label: t('review.scope.staged') },
    { id: 'uncommitted', label: t('review.scope.uncommitted') },
    ...(historyTurns.length > 0
      ? [{ type: 'label' as const, id: 'history-label', text: t('review.scope.history') }]
      : []),
    ...historyTurns.map(turn => ({ id: `turn:${turn.turn}`, label: t('review.scope.turn', { turn: turn.turn }) })),
  ], [historyTurns, t])
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    left: <Menu
      open={scopeMenuOpen}
      items={scopeItems}
      selectedId={scopeId}
      onClose={() => { setScopeMenuOpen(false) }}
      onSelect={id => {
        setScopeMenuOpen(false)
        const next: ReviewScope = id.startsWith('turn:') ? { turn: Number(id.slice(5)) } : id as Exclude<ReviewScope, { turn: number }>
        setMissedPath(null)
        setEagerPath(null)
        setExpandedPaths(new Set())
        void controller.selectScope(next).then((outcome) => {
          if (outcome.kind !== 'ready' && outcome.kind !== 'found') return
          const paths = controller.getSnapshot().status?.files.map(file => file.path) ?? []
          const expanded = new Set(paths)
          expandedRef.current = expanded
          setExpandedPaths(expanded)
          requestAnimationFrame(() => {
            listRef.current?.querySelector<HTMLElement>('[data-review-path]')
              ?.scrollIntoView({ block: 'start' })
          })
        })
      }}
      anchor={<button
        type="button"
        className={css.reviewScopeButton}
        aria-label={t('review.scope.choose')}
        aria-expanded={scopeMenuOpen}
        onClick={() => { setScopeMenuOpen(open => !open) }}
      >
        <span>{scopeLabel}</span><IconChevronDownOutline14 />
      </button>}
    />,
    right: <>
      <WorkbenchPanelIconButton
        label={anyExpanded ? t('review.collapseAll') : t('review.expandAll')}
        className={css.reviewBulkToggle}
        disabled={(meta.status?.files.length ?? 0) === 0}
        onClick={() => {
          const paths = meta.status?.files.map(file => file.path) ?? []
          const next = anyExpanded ? new Set<string>() : new Set(paths)
          expandedRef.current = next
          // Mounting many warmed DiffBlocks is still a large render: mark the
          // expansion as a transition so the UI keeps answering input.
          if (anyExpanded) setExpandedPaths(next)
          else startTransition(() => { setExpandedPaths(next) })
        }}
      >
        {anyExpanded ? <IconUnfoldLessOutline16 /> : <IconUnfoldMoreOutline16 />}
      </WorkbenchPanelIconButton>
      <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { void controller.refresh({ runChecks: true }) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>
    </>
  }), [anyExpanded, meta.status, controller, scopeId, scopeItems, scopeLabel, scopeMenuOpen, t])
  usePanelHeaderActions(contributeHeaderActions, headerActions)

  return (
    <div className={css.review}>
      {meta.error !== null && <div className={css.error}>{meta.error}</div>}
      <div className={css.reviewBody}>
        <div className={css.reviewStatus}>
          <strong>{meta.status?.branch || t('review.title')} → {scopeLabel}</strong>
          <span>{meta.checks !== null && !meta.checks.clean
            ? t('review.checks.failed')
            : <ReviewTotals controller={controller} />}</span>
        </div>
        {missedPath !== null && (
          <div className={css.reviewMissed} role="status">{t('review.missedFile')}<FileIcon path={missedPath} /><code>{missedPath}</code></div>
        )}
        {meta.status === null
          ? <div className={css.reviewPlaceholder}>{meta.error === null ? t('loading') : t('review.loadFailed')}</div>
          : meta.status.files.length === 0
            ? <div className={css.reviewPlaceholder}>{t('review.clean')}</div>
            : <div ref={listRef} className={css.fileList} role="list" aria-label={t('review.files')}>
              {gate.hasBeforeBoundary && (
                <div
                  ref={gate.beforeSentinelRef}
                  className={css.reviewLoadBoundary}
                  data-review-boundary="before"
                  role="status"
                >{t('loading')}</div>
              )}
              {gate.files.map(file => (
                <ReviewFileRow
                  key={file.path}
                  file={file}
                  summary={summaries.get(file.path)}
                  controller={controller}
                  expanded={expandedPaths.has(file.path)}
                  resident={residency.resident.has(file.path)}
                  scrollRoot={residency.scrollRoot}
                  widthBucket={residency.widthBucket}
                  onToggle={toggleFile}
                  t={t}
                />
              ))}
              {gate.hasAfterBoundary && (
                <div
                  ref={gate.afterSentinelRef}
                  className={css.reviewLoadBoundary}
                  data-review-boundary="after"
                  role="status"
                >{t('loading')}</div>
              )}
            </div>}
      </div>
    </div>
  )
}

export function TerminalPanel({ terminal, useSessions, sessionId, tabs, activeInstanceId, openInstance, contributeHeaderActions, contributePanelInfo, t }: TerminalProps) {
  const addressed = useSessions(snapshot => snapshot.currentAddress?.childSessionId === sessionId)
  const [sessions, setSessions] = useState<TerminalSessionView[]>([])
  const [backends, setBackends] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    if (addressed) return
    const [listWire, backendWire] = await Promise.all([terminal.list(sessionId), terminal.backends(sessionId)])
    if (!listWire.ok) throw transportError(listWire)
    if (!backendWire.ok) throw transportError(backendWire)
    if (!listWire.value.ok) throw new Error(listWire.value.message)
    if (!backendWire.value.ok) throw new Error(backendWire.value.message)
    setSessions(listWire.value.sessions); setBackends(backendWire.value.backends); setError(null)
  }, [addressed, sessionId, terminal])

  useEffect(() => { void refresh().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }) }, [refresh])

  const previousTabs = useRef({ sessionId, tabs })
  useEffect(() => {
    const previous = previousTabs.current
    if (previous.sessionId === sessionId) {
      for (const id of previous.tabs) {
        if (tabs.includes(id)) continue
        void terminal.kill(sessionId, id).then((wire) => {
          if (!wire.ok) throw transportError(wire)
          if (!wire.value.ok) throw new Error(wire.value.message)
        }).catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) })
      }
    }
    previousTabs.current = { sessionId, tabs }
  }, [sessionId, tabs, terminal])

  const spawn = useCallback(async () => {
    const type = backends[0]
    if (type === undefined) throw new Error(t('terminal.noBackend'))
    // No `name`: the official terminal service enforces per-owner name
    // uniqueness (DUPLICATE_NAME), and the tab label comes from the session
    // cwd anyway.
    const wire = await terminal.spawn(sessionId, { type })
    if (!wire.ok) throw transportError(wire)
    if (!wire.value.ok) throw new Error(wire.value.message)
    // Merge the spawn view immediately so the new pill shows its project
    // label without waiting for the list round-trip. Hoisted const: the
    // wire.value discriminant narrowing does not survive the closure below.
    const view = wire.value.session
    setSessions(previous => previous.some(item => item.sessionId === view.sessionId)
      ? previous
      : [...previous, view])
    openInstance(view.sessionId); await refresh()
  }, [backends, openInstance, refresh, sessionId, t, terminal])
  const initializedSessions = useRef(new Set<string>())
  useEffect(() => {
    if (addressed || initializedSessions.current.has(sessionId)) return
    if (tabs.length > 0) {
      initializedSessions.current.add(sessionId)
      return
    }
    if (backends.length === 0) return
    initializedSessions.current.add(sessionId)
    const existing = sessions.find(item => item.status.kind === 'running' && item.interactive === true)
      ?? sessions.find(item => item.status.kind === 'running')
    if (existing !== undefined) {
      openInstance(existing.sessionId)
      return
    }
    void spawn().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) })
  }, [addressed, backends.length, openInstance, sessionId, sessions, spawn, tabs.length])
  const handleTerminalExit = useCallback(() => { void refresh() }, [refresh])
  // Tab pills show each PTY's project folder; the group title carries the
  // active PTY's shell program ("终端 · PowerShell").
  const titleSuffix = (sessions.find(item => item.sessionId === activeInstanceId) ?? sessions[0])?.shell
  const panelInfo = useMemo<WorkbenchPanelInfoContribution>(() => ({
    tabLabels: terminalTabLabels(sessions),
    ...(titleSuffix === undefined ? {} : { titleSuffix }),
  }), [sessions, titleSuffix])
  useEffect(() => contributePanelInfo(panelInfo), [contributePanelInfo, panelInfo])
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    left: <WorkbenchPanelIconButton label={t('terminal.new')} disabled={addressed || backends.length === 0} onClick={() => { void spawn().catch(reason => { setError(String(reason)) }) }}><IconPlusOutline16 size={14} /></WorkbenchPanelIconButton>,
  }), [addressed, backends.length, spawn, t])
  usePanelHeaderActions(contributeHeaderActions, headerActions)
  if (addressed) return <Empty title={t('terminal')} body={t('terminal.unavailable')} />
  if (activeInstanceId === undefined) {
    return <div className={css.tool}>{error !== null && <div className={css.error}>{error}</div>}<Empty title={t('terminal.empty.title')} body={t('terminal.empty.body')} /></div>
  }
  const active = sessions.find(item => item.sessionId === activeInstanceId)
  return (
    <div className={css.terminal}>
      {error !== null && <div className={css.error}>{error}</div>}
      {active?.interactive === true
        ? <TerminalEmulator
            terminal={terminal}
            agentSessionId={sessionId}
            terminalSessionId={activeInstanceId}
            onError={setError}
            onExit={handleTerminalExit}
          />
        : <Empty title={active?.name ?? t('terminal')} body={t('terminal.legacy')} />}
    </div>
  )
}

function safeLoopback(raw: string): URL | null {
  try {
    const value = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]')) return null
    return url
  } catch { return null }
}

export function BrowserPanel({ sessionId, route, tabs, activeInstanceId, openInstance, showHome, contributeHeaderActions, t }: Props) {
  const [draft, setDraft] = useState(activeInstanceId ?? 'http://localhost:3000')
  const [error, setError] = useState<string | null>(null)
  const activeUrl = activeInstanceId === undefined ? null : safeLoopback(activeInstanceId)
  const desktopBridge = window.deepcreatorBrowser
  const desktopViewport = useRef<HTMLDivElement | null>(null)
  const desktopId = activeUrl === null ? null : `${sessionId}:${activeUrl.href}`
  const openInstanceRef = useRef(openInstance); openInstanceRef.current = openInstance
  const tabsRef = useRef(tabs); tabsRef.current = tabs

  useEffect(() => {
    if (desktopBridge === undefined || desktopId === null || activeUrl === null) return
    const element = desktopViewport.current
    if (element === null) return
    const bounds = () => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    void desktopBridge.create(desktopId, activeUrl.href, bounds()).catch(() => { setError(t('browser.frameError')) })
    const observer = new ResizeObserver(() => { void desktopBridge.setBounds(desktopId, bounds()) }); observer.observe(element)
    const offPopup = desktopBridge.onPopup(popup => { if (popup.sourceId === desktopId) openInstanceRef.current(popup.url) })
    return () => { observer.disconnect(); offPopup(); void desktopBridge.setBounds(desktopId, { x: 0, y: 0, width: 0, height: 0 }) }
  }, [activeUrl?.href, desktopBridge, desktopId, t])

  const previousTabs = useRef<readonly string[]>(tabs)
  useEffect(() => { if (desktopBridge !== undefined) for (const tab of previousTabs.current) if (!tabs.includes(tab)) void desktopBridge.close(`${sessionId}:${tab}`); previousTabs.current = tabs }, [desktopBridge, sessionId, tabs])
  useEffect(() => () => { if (desktopBridge !== undefined) for (const tab of tabsRef.current) void desktopBridge.close(`${sessionId}:${tab}`) }, [desktopBridge, sessionId])
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    left: <WorkbenchPanelIconButton label={t('browser.open')} onClick={showHome}><IconPlusOutline16 size={14} /></WorkbenchPanelIconButton>,
  }), [showHome, t])
  usePanelHeaderActions(contributeHeaderActions, headerActions)
  const submit = (event: FormEvent) => { event.preventDefault(); const url = safeLoopback(draft); if (url === null) { setError(t('browser.invalid')); return }; setError(null); openInstance(url.href) }
  return <div className={css.browser}>
    {error !== null && <div className={css.error}>{error}</div>}
    {route === 'instance' && activeUrl !== null
      ? desktopBridge === undefined
        ? <div className={css.viewport}><iframe title={activeUrl.href} src={activeUrl.href} sandbox="allow-forms allow-same-origin allow-scripts" onError={() => { setError(t('browser.frameError')) }} />{error === t('browser.frameError') && <button type="button" className={css.external} onClick={() => { window.open(activeUrl.href, '_blank', 'noopener,noreferrer') }}>{t('browser.external')}</button>}</div>
        : <div ref={desktopViewport} className={css.viewport} data-desktop-browser-view />
      : <div className={css.browserHome}><form className={css.address} onSubmit={submit}><input aria-label={t('browser.prompt')} value={draft} onChange={event => { setDraft(event.currentTarget.value) }} spellCheck={false} /><button type="submit">{t('browser.open')}</button></form></div>}
  </div>
}
