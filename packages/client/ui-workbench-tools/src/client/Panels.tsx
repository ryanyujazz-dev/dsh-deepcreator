import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@ryanyujazz/dsh-review/remote'
import type { ReviewFileStatus, ReviewFileSummary, ReviewScope } from '@ryanyujazz/dsh-review/types'
import type { TerminalSessionView } from '@ryanyujazz/dsh-terminal-workbench/types'
import type {} from '@ryanyujazz/dsh-terminal-workbench/remote'
import type {
  WorkbenchPanelHeaderContribution, WorkbenchPanelInfoContribution, WorkbenchPanelProps,
} from '@ryanyujazz/dsh-client-ui-workbench/client'
import {
  DiffBlock, FileIcon, IconChevronDownOutline14, IconFolderClose16, IconPlusOutline16, IconRefreshOutline14, IconUnfoldLessOutline16,
  IconUnfoldMoreOutline16, Menu, OverflowFadeText, WorkbenchPanelIconButton, type MenuEntry,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { ReviewCacheController } from './review-cache.ts'
import { isReviewPanelFile } from './review-model.ts'
import css from './Panels.module.css'
import { TerminalEmulator } from './TerminalEmulator.tsx'

export { matchReviewFile } from './review-model.ts'

type Props = WorkbenchPanelProps & PropsLocale<'workbench-tools'>
type RemoteProps = Props & { remote: TypertClientRemote }
type TerminalProps = Props & { terminal: TypertClientRemote['terminal-workbench'] }


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

type ReviewPanelProps = WorkbenchPanelProps & PropsLocale<'workbench-tools'> & { controller: ReviewCacheController }
const EMPTY_REVIEW_FILES: readonly ReviewFileStatus[] = []
const EMPTY_FOLD_KEYS: ReadonlySet<string> = new Set()

function reviewRowEstimate(summary: ReviewFileSummary | undefined, expanded: boolean): number {
  if (!expanded) return 36
  if (summary?.binary === true) return 156
  // An unseen expanded row contains only its 36px header and 72px loading
  // body. Reserving the eventual diff height creates phantom blank regions
  // when the scrollbar jumps over cold files; measured ready rows replace
  // this compact estimate as soon as their patch mounts.
  return 108
}

/**
 * One file row: header + expanded body. All props are stable references
 * (the merge keeps unchanged entries' identity), so one entry's fetch or
 * revalidate re-renders only its own row and the parse-once layer objects
 * keep DiffBlock's internal diff/highlight memos alive.
 *
 * The outer virtualizer only mounts rows near the viewport. Logical expansion
 * and controlled fold state survive unmounts, while lazy source loading keeps
 * complete file contents out of the initial patch and highlighting pipeline.
 */
const ReviewFileRow = memo(function ReviewFileRow({
  file, summary, controller, expanded, onToggle, onOpenRepository, t,
}: {
  file: ReviewFileStatus
  summary: ReviewFileSummary | undefined
  controller: ReviewCacheController
  expanded: boolean
  onToggle: (path: string) => void
  onOpenRepository: (path: string) => void
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

  const onHeaderClick = useCallback(() => {
    if (file.kind === 'repository' || file.kind === 'submodule') { onOpenRepository(file.path); return }
    if (!expanded) controller.ensure(file.path, 'focus')
    onToggle(file.path)
  }, [controller, expanded, file.kind, file.path, onOpenRepository, onToggle])
  const loadSource = useCallback(
    async (side: 'old' | 'new') => await controller.source(file.path, side),
    [controller, file.path],
  )
  const additions = summary?.additions ?? ready?.added
  const deletions = summary?.deletions ?? ready?.removed
  const lineStatsAvailable = summary?.lineStatsState === 'available'
    || (summary?.lineStatsState === undefined && summary?.binary !== true && additions !== undefined && deletions !== undefined
      && (additions > 0 || deletions > 0))
  const showCounts = lineStatsAvailable && additions !== undefined && deletions !== undefined
  const presentation = summary?.presentation ?? ready?.raw.presentation ?? file.presentation ?? 'unknown'
  const atomic = file.kind === 'repository' || file.kind === 'submodule'
  const hasRenderableDiff = ready?.layers.some(layer => layer.files.some(parsed => parsed.binary || parsed.hunks.length > 0)) ?? false
  return (
    <article className={css.reviewFile} data-review-path={file.path}>
      <button
        type="button"
        className={css.reviewFileHeader}
        aria-expanded={atomic ? undefined : expanded}
        onClick={onHeaderClick}
      >
        <IconChevronDownOutline14 className={expanded ? undefined : css.reviewFileChevronCollapsed} />
        {atomic ? <IconFolderClose16 size={14} /> : <FileIcon path={file.path} />}
        <OverflowFadeText className={css.reviewFilePath} text={label} fade="left" />
        {pending && summary === undefined
          ? <span className={css.reviewFileLoading}>{t('loading')}</span>
          : showCounts && <span className={css.reviewCounts}><b>{`+${additions}`}</b><i>{`-${deletions}`}</i></span>}
      </button>
      {!atomic && expanded && (
        <div className={css.reviewFileContent}>
          {pending && <div className={css.reviewFileMessage}>{t('loading')}</div>}
          {failed !== null && <div className={css.reviewFileError}>{failed}</div>}
          {ready !== null && !hasRenderableDiff && presentation !== 'text' && (
            <div className={css.binary}>{t(`review.presentation.${presentation}`)}</div>
          )}
          {ready !== null && hasRenderableDiff && ready.layers.map(layer => (
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
                    loadSource={loadSource}
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
  const [missedPath, setMissedPath] = useState<string | null>(null)
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  const repositoryParents = useRef(new Map<string, string>())
  const repositoryViews = useRef(new Map<string, { expanded: ReadonlySet<string>; scrollTop: number }>() )
  const expandedRef = useRef(expandedPaths); expandedRef.current = expandedPaths
  const prevVisible = useRef(false)
  /** Whether the current open has already been handled (expand-all or reveal). */
  const openHandled = useRef(false)
  const files = meta.status?.files ?? EMPTY_REVIEW_FILES
  const summaries = useMemo(() => new Map(meta.summary?.files.map(file => [file.path, file]) ?? []), [meta.summary])
  const scopeId = typeof meta.scope === 'string' ? meta.scope : `turn:${meta.scope.turn}`
  // A repository-relative path is not a global row identity: root and nested
  // repositories commonly both contain README.md/package.json, and scopes can
  // carry different hunk heights for the same path.
  const rowKeyPrefix = useMemo(() => JSON.stringify([meta.repository, scopeId]), [meta.repository, scopeId])
  const getScrollElement = useCallback(() => listRef.current, [])
  const estimateRow = useCallback((index: number) => {
    const file = files[index]
    return file === undefined ? 36 : reviewRowEstimate(summaries.get(file.path), expandedPaths.has(file.path))
  }, [expandedPaths, files, summaries])
  const getRowKey = useCallback((index: number) => `${rowKeyPrefix}:${files[index]?.path ?? index}`, [files, rowKeyPrefix])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: files.length,
    getScrollElement,
    estimateSize: estimateRow,
    measureElement: (element, entry) => {
      const measured = entry?.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height
      const index = Number(element.dataset.index)
      return measured > 0 ? measured : estimateRow(Number.isSafeInteger(index) ? index : 0)
    },
    getItemKey: getRowKey,
    overscan: 5,
    initialRect: { width: 0, height: 720 },
    observeElementRect: (instance, callback) => {
      const element = instance.scrollElement
      if (element === null) return undefined
      const update = () => {
        callback({ width: element.clientWidth || 320, height: element.clientHeight || 720 })
      }
      update()
      if (typeof ResizeObserver === 'undefined') return undefined
      const observer = new ResizeObserver(update)
      observer.observe(element)
      return () => { observer.disconnect() }
    },
  })
  // TanStack registers a measured element before its scroll element may have
  // established targetWindow when the viewport and its first rows mount in
  // the same commit. In that ordering the node enters elementsCache but no
  // ResizeObserver subscription is created, so an async patch can grow from
  // the 108px loading estimate to thousands of pixels while every following
  // row keeps its estimated top. Own an explicit, disposable observation at
  // the Review adapter boundary and feed exact border-box growth back into
  // the public resizeItem API. The library observer remains useful for normal
  // later mounts; duplicate identical measurements are idempotent.
  const rowResizeObserver = useRef<ResizeObserver | null>(null)
  const observedRows = useRef(new Set<HTMLDivElement>())
  const measureVirtualRow = useCallback((element: HTMLDivElement | null) => {
    virtualizer.measureElement(element)
    const observer = rowResizeObserver.current
    if (element !== null) {
      observedRows.current.add(element)
      observer?.observe(element, { box: 'border-box' })
    }
    for (const candidate of observedRows.current) {
      if (candidate.isConnected) continue
      observer?.unobserve(candidate)
      observedRows.current.delete(candidate)
    }
  }, [virtualizer])
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLDivElement
        if (!element.isConnected) {
          observer.unobserve(element)
          observedRows.current.delete(element)
          continue
        }
        const index = Number(element.dataset.index)
        const measured = entry.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height
        if (Number.isSafeInteger(index) && index >= 0 && measured > 0) virtualizer.resizeItem(index, measured)
      }
    })
    rowResizeObserver.current = observer
    listRef.current?.querySelectorAll<HTMLDivElement>('[data-review-virtual-row]').forEach(element => {
      observedRows.current.add(element)
      observer.observe(element, { box: 'border-box' })
    })
    return () => {
      if (rowResizeObserver.current === observer) rowResizeObserver.current = null
      observer.disconnect()
      observedRows.current.clear()
    }
  }, [rowKeyPrefix, virtualizer])
  const virtualItems = virtualizer.getVirtualItems()
  const scrollOffset = virtualizer.scrollOffset ?? 0
  const viewportHeight = listRef.current?.clientHeight ?? 720
  const viewportEnd = scrollOffset + viewportHeight
  const scrollReviewIndex = useCallback((index: number, behavior: ScrollBehavior = 'auto') => {
    if (index < 0) return
    const measured = virtualizer.getOffsetForIndex(index, 'start')?.[0]
    let offset = measured ?? 0
    if (index > 0 && offset <= 0) {
      for (let cursor = 0; cursor < index; cursor += 1) offset += estimateRow(cursor)
    }
    listRef.current?.scrollTo({ top: offset, behavior })
  }, [estimateRow, virtualizer])
  const scrollReviewIndexRef = useRef(scrollReviewIndex); scrollReviewIndexRef.current = scrollReviewIndex
  const resident = useMemo(() => new Set(virtualItems.flatMap(item => {
    const path = files[item.index]?.path
    return path === undefined ? [] : [path]
  })), [files, virtualItems])
  const visiblePaths = useMemo(() => new Set(virtualItems.flatMap(item => {
    if (item.end <= scrollOffset || item.start >= viewportEnd) return []
    const path = files[item.index]?.path
    return path === undefined ? [] : [path]
  })), [files, scrollOffset, viewportEnd, virtualItems])
  const overscanPaths = useMemo(() => {
    const paths = virtualItems.flatMap(item => {
      const path = files[item.index]?.path
      return path === undefined || visiblePaths.has(path) ? [] : [path]
    })
    return virtualizer.scrollDirection === 'backward' ? paths.toReversed() : paths
  }, [files, virtualItems, virtualizer.scrollDirection, visiblePaths])
  useEffect(() => {
    controller.setResident(resident)
    for (const path of visiblePaths) if (expandedPaths.has(path)) controller.ensure(path, 'viewport')
    for (const path of overscanPaths) if (expandedPaths.has(path)) controller.ensure(path, 'overscan')
  }, [controller, expandedPaths, overscanPaths, resident, visiblePaths])
  useLayoutEffect(() => {
    // measure() deliberately drops all cached sizes so offscreen rows return
    // to the current expanded/collapsed estimates. Doing that in a passive
    // effect can erase a warm body's already-correct ResizeObserver result
    // after paint and leave every following absolute row at the 108px
    // estimate. Reset before paint, then synchronously restore the bounded
    // mounted viewport from its actual DOM boxes; later patch/wrap growth
    // continues through the virtualizer's shared ResizeObserver.
    virtualizer.measure()
    listRef.current?.querySelectorAll<HTMLDivElement>('[data-review-virtual-row]').forEach(element => {
      const index = Number(element.dataset.index)
      const height = element.getBoundingClientRect().height
      if (Number.isSafeInteger(index) && index >= 0 && height > 0) virtualizer.resizeItem(index, height)
    })
  }, [expandedPaths, rowKeyPrefix, virtualizer])

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
    const next = new Set(files.filter(file => file.kind !== 'repository' && file.kind !== 'submodule').map(file => file.path))
    expandedRef.current = next
    startTransition(() => { setExpandedPaths(next) })
    // Focus the top after the expansion joins the layout.
    requestAnimationFrame(() => { scrollReviewIndexRef.current(0) })
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
    const requestedRepository = typeof reveal.parameters?.repository === 'string'
      ? reveal.parameters.repository.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '') : ''
    // Every Review presentation is expand-all by contract. Parameters still
    // spell it out for self-documenting entry points, but this provider-side
    // default prevents a future or fallback reveal from silently regressing.
    const selection = controller.getSnapshot().repository === requestedRepository
      ? controller.selectScope(requested, reveal.target)
      : controller.selectRepository(requestedRepository, requested, reveal.target)
    void selection.then((outcome) => {
      if (outcome.kind === 'missing') {
        if (reveal.target !== undefined) setMissedPath(reveal.target)
        return
      }
      if (outcome.kind === 'ready' || outcome.kind === 'found') {
        const paths = controller.getSnapshot().status?.files
          .filter(file => file.kind !== 'repository' && file.kind !== 'submodule').map(file => file.path) ?? []
        const next = new Set(paths)
        expandedRef.current = next
        const focus = outcome.kind === 'found' ? outcome.path : null
        setExpandedPaths(next)
        requestAnimationFrame(() => {
          const index = focus === null ? 0 : paths.indexOf(focus)
          if (index >= 0) scrollReviewIndexRef.current(index, focus === null ? 'auto' : 'smooth')
        })
      }
    }).catch(() => {
      // Reveal refresh failures keep the last good panel; the optimistic
      // expansion above already pointed the user at the file.
    })
  }, [reveal, controller])

  const navigateRepository = useCallback((repository: string): void => {
    repositoryViews.current.set(meta.repository, {
      expanded: expandedRef.current,
      scrollTop: listRef.current?.scrollTop ?? 0,
    })
    setMissedPath(null); setExpandedPaths(new Set())
    void controller.selectRepository(repository).then(outcome => {
      if (outcome.kind !== 'ready' && outcome.kind !== 'found') return
      const available = controller.getSnapshot().status?.files
        .filter(file => file.kind !== 'repository' && file.kind !== 'submodule').map(file => file.path) ?? []
      const retained = repositoryViews.current.get(repository)
      const next = retained === undefined
        ? new Set(available)
        : new Set(available.filter(path => retained.expanded.has(path)))
      expandedRef.current = next
      setExpandedPaths(next)
      if (retained !== undefined) requestAnimationFrame(() => {
        if (listRef.current !== null) listRef.current.scrollTop = retained.scrollTop
      })
    })
  }, [controller, meta.repository])

  const openRepository = useCallback((path: string): void => {
    const repository = [meta.repository, path].filter(Boolean).join('/')
    repositoryParents.current.set(repository, meta.repository)
    navigateRepository(repository)
  }, [meta.repository, navigateRepository])

  const repositoryChain = useMemo(() => {
    const result: string[] = []
    let current = meta.repository
    const seen = new Set<string>()
    while (current !== '' && !seen.has(current)) {
      seen.add(current); result.unshift(current)
      current = repositoryParents.current.get(current) ?? ''
    }
    return result
  }, [meta.repository])

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
    }
  }, [controller])

  // One header action left of the refresh button: expand-all when nothing is
  // expanded, collapse-all otherwise — the icon states swap with the action.
  const anyExpanded = expandedPaths.size > 0
  const scopeLabel = typeof meta.scope === 'string'
    ? t(`review.scope.${meta.scope}`)
    : t('review.scope.turn', { turn: meta.scope.turn })
  const historyTurns = useMemo(() => history?.turns
    .filter(turn => turn.files.some(file => file.state === 'pending' && isReviewPanelFile(file)
      && (meta.repository === '' || (file.repository ?? '') === meta.repository)))
    .toSorted((a, b) => b.turn - a.turn) ?? [], [history, meta.repository])
  const currentTurns = useMemo(() => historyTurns.filter(turn => turn.current === true), [historyTurns])
  const completedTurns = useMemo(() => historyTurns.filter(turn => turn.current !== true), [historyTurns])
  const workspaceKind = meta.status?.workspaceKind ?? (meta.repository === '' ? history?.workspaceKind : 'git') ?? 'git'
  const scopeItems = useMemo<MenuEntry[]>(() => [
    ...(workspaceKind === 'git' ? [
      { id: 'unstaged', label: t('review.scope.unstaged') },
      { id: 'staged', label: t('review.scope.staged') },
      { id: 'uncommitted', label: t('review.scope.uncommitted') },
    ] : []),
    ...(currentTurns.length > 0
      ? [{ type: 'label' as const, id: 'current-label', text: t('review.scope.current') }]
      : []),
    ...currentTurns.map(turn => ({ id: `turn:${turn.turn}`, label: t('review.scope.turn.current', { turn: turn.turn }) })),
    ...(completedTurns.length > 0
      ? [{ type: 'label' as const, id: 'history-label', text: t('review.scope.history') }]
      : []),
    ...completedTurns.map(turn => ({ id: `turn:${turn.turn}`, label: t('review.scope.turn', { turn: turn.turn }) })),
  ], [completedTurns, currentTurns, t, workspaceKind])
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
        setExpandedPaths(new Set())
        void controller.selectScope(next).then((outcome) => {
          if (outcome.kind !== 'ready' && outcome.kind !== 'found') return
          const paths = controller.getSnapshot().status?.files
            .filter(file => file.kind !== 'repository' && file.kind !== 'submodule').map(file => file.path) ?? []
          const expanded = new Set(paths)
          expandedRef.current = expanded
          setExpandedPaths(expanded)
          requestAnimationFrame(() => { scrollReviewIndexRef.current(0) })
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
          const paths = meta.status?.files.filter(file => file.kind !== 'repository' && file.kind !== 'submodule').map(file => file.path) ?? []
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
      {meta.warning !== null && <div className={css.reviewWarning} role="status">{t('review.summaryWarning')}: {meta.warning}</div>}
      <div className={css.reviewBody}>
        {meta.repository !== '' && (
          <nav className={css.reviewBreadcrumb} aria-label={t('review.repository.breadcrumb')}>
            <button type="button" onClick={() => { navigateRepository('') }}>{t('review.repository.root')}</button>
            {repositoryChain.map((repository, index) => (
              <span className={css.reviewBreadcrumbSegment} key={repository}>
                <span aria-hidden>›</span>
                {index === repositoryChain.length - 1
                  ? <OverflowFadeText text={repository.split('/').at(-1) ?? repository} fade="left" />
                  : <button type="button" onClick={() => { navigateRepository(repository) }}>{repository.split('/').at(-1) ?? repository}</button>}
              </span>
            ))}
          </nav>
        )}
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
              <div className={css.reviewVirtualCanvas} style={{ height: virtualizer.getTotalSize() }}>
                {virtualItems.map(item => {
                  const file = files[item.index]
                  if (file === undefined) return null
                  return <div
                    key={item.key}
                    ref={measureVirtualRow}
                    data-index={item.index}
                    data-review-virtual-row=""
                    className={css.reviewVirtualRow}
                    // A transformed ancestor changes Chromium's containing
                    // block for the sticky file header. Positioning the small
                    // mounted window by `top` keeps the header attached to the
                    // Review scroller and preserves file/diff association.
                    style={{ top: item.start }}
                  >
                    <ReviewFileRow
                      file={file}
                      summary={summaries.get(file.path)}
                      controller={controller}
                      expanded={expandedPaths.has(file.path)}
                      onToggle={toggleFile}
                      onOpenRepository={openRepository}
                      t={t}
                    />
                  </div>
                })}
              </div>
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
