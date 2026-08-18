import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArtifactRecord } from '@ryanyujazz/dsh-artifacts/types'
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import type {} from '@ryanyujazz/dsh-review/remote'
import type { TerminalSessionView } from '@ryanyujazz/dsh-terminal-workbench/types'
import type {} from '@ryanyujazz/dsh-terminal-workbench/remote'
import type {
  WorkbenchPanelHeaderContribution, WorkbenchPanelInfoContribution, WorkbenchPanelProps,
} from '@ryanyujazz/dsh-client-ui-workbench/client'
import {
  DiffBlock, IconChevronDownOutline14, IconPlusOutline16, IconRefreshOutline14, IconUnfoldLessOutline14,
  IconUnfoldMoreOutline14, WorkbenchPanelIconButton,
} from '@ryanyujazz/dsh-client-ui-primitives'
import {
  matchReviewFile, type FileEntry,
} from './review-model.ts'
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

export function ArtifactPanel({ remote, sessionId, route, activeInstanceId, openInstance, contributeHeaderActions, renderArtifact, t }: RemoteProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const wire = await remote.artifacts.list(sessionId)
    if (!wire.ok) throw transportError(wire)
    if (!wire.value.ok) throw new Error(wire.value.message)
    setArtifacts(wire.value.artifacts)
    setError(null)
    setLoading(false)
  }, [remote, sessionId])

  useEffect(() => { void refresh().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false) }) }, [refresh])
  useEffect(() => {
    setContent(null)
    if (route !== 'instance' || activeInstanceId === undefined) return
    let live = true
    void remote.artifacts.read(sessionId, activeInstanceId).then((wire) => {
      if (!live) return
      if (!wire.ok) throw transportError(wire)
      if (!wire.value.ok) throw new Error(wire.value.message)
      setContent(wire.value.content)
      setError(null)
    }).catch(reason => { if (live) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { live = false }
  }, [activeInstanceId, remote, route, sessionId])
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    right: <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { void refresh().catch(reason => { setError(String(reason)) }) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>,
  }), [refresh, t])
  usePanelHeaderActions(contributeHeaderActions, headerActions)

  if (route === 'instance' && activeInstanceId !== undefined) {
    const artifact = artifacts.find(item => item.id === activeInstanceId)
    return (
      <div className={css.document}>
        {error !== null && <div className={css.error}>{error}</div>}
        {artifact !== undefined && content !== null
          ? <div className={css.artifactContent}>{renderArtifact({ artifactId: artifact.id, kind: artifact.kind, content, ...(artifact.mime === undefined ? {} : { mime: artifact.mime }) })}</div>
          : error === null && <Empty title={artifact?.title ?? activeInstanceId} body={t('loading')} />}
      </div>
    )
  }
  return (
    <div className={css.tool}>
      {error !== null && <div className={css.error}>{error}</div>}
      {artifacts.length === 0
        ? <Empty title={loading ? t('loading') : t('artifact.empty.title')} body={t('artifact.empty.body')} />
        : <div className={css.list}>{artifacts.map(artifact => <button type="button" key={artifact.id} onClick={() => { openInstance(artifact.id) }}><span><strong>{artifact.title}</strong><small>{artifact.kind} · {artifact.status}</small></span><time>{new Date(artifact.updatedAt).toLocaleString()}</time></button>)}</div>}
    </div>
  )
}

/** Mount a file's diff content when it is this close to the viewport. */
const NEAR_VIEWPORT_MARGIN = 400

/** A frame gap above this means scrolling paused; heavy bodies fill then. */
const BODY_FILL_IDLE_MS = 120

/**
 * One heavy body per frame, only when scrolling pauses. Batch-expanded files
 * mount a light skeleton as they enter the viewport (scrolling stays on the
 * compositor); the real DiffBlock mounts through this queue once scroll
 * activity has been quiet for a pause window, one per frame, so a fast scroll
 * never waits on a burst of heavy commits.
 */
const bodyFillQueue: Array<() => void> = []
let bodyFillFrame: number | null = null
/** After this timestamp with no scroll activity, bodies may fill. */
let bodyFillIdleAt = 0
let scrollListening = false

function onScrollCapture(): void {
  bodyFillIdleAt = performance.now() + BODY_FILL_IDLE_MS
}

function requestBodyFill(fill: () => void): void {
  // jsdom (and other hosts without rAF) fills synchronously: tests observe
  // the fully mounted body without frame machinery.
  if (typeof requestAnimationFrame === 'undefined') { fill(); return }
  if (!scrollListening && typeof window !== 'undefined') {
    scrollListening = true
    window.addEventListener('scroll', onScrollCapture, true)
  }
  bodyFillQueue.push(fill)
  bodyFillIdleAt = performance.now() + BODY_FILL_IDLE_MS
  if (bodyFillFrame === null) {
    bodyFillFrame = requestAnimationFrame(tickBodyFill)
  }
}

function tickBodyFill(now: number): void {
  bodyFillFrame = null
  if (now < bodyFillIdleAt) {
    // Scrolling (or a fresh request) is still active: wait it out.
    bodyFillFrame = requestAnimationFrame(tickBodyFill)
    return
  }
  const fill = bodyFillQueue.shift()
  if (fill === undefined) return
  fill()
  if (bodyFillQueue.length > 0) {
    // One heavy commit per frame, then breathe before the next.
    bodyFillIdleAt = now + 40
    bodyFillFrame = requestAnimationFrame(tickBodyFill)
  }
}

type ReviewPanelProps = WorkbenchPanelProps & PropsLocale<'workbench-tools'> & { controller: ReviewCacheController }

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
 * expand-all. Once mounted the body stays mounted: collapsing only hides it,
 * so a collapse→expand cycle is a pure CSS flip with zero rebuild.
 */
const ReviewFileRow = memo(function ReviewFileRow({
  entry, expanded, onToggle, t,
}: {
  entry: FileEntry
  expanded: boolean
  onToggle: (path: string) => void
  t: RemoteProps['t']
}) {
  const file = entry.status
  const ready = entry.cache.kind === 'ready' ? entry.cache : null
  const pending = entry.cache.kind === 'loading' || entry.cache.kind === 'empty'
  const failed = entry.cache.kind === 'error' ? entry.cache.message : null
  const oldPath = ready?.raw.oldPath ?? file.oldPath
  const label = oldPath !== undefined && oldPath !== file.path ? `${oldPath} → ${file.path}` : file.path
  const [skeletonMounted, setSkeletonMounted] = useState(false)
  const [bodyMounted, setBodyMounted] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)
  // Approaching the viewport mounts only the light skeleton — a scrolling
  // frame must never commit a full diff body.
  useEffect(() => {
    if (skeletonMounted || !expanded) return
    const node = anchorRef.current
    if (node === null) return
    // jsdom (and any host without IntersectionObserver) mounts immediately;
    // browsers mount near the viewport now and observe the rest.
    if (typeof IntersectionObserver === 'undefined') { setSkeletonMounted(true); return }
    const rect = node.getBoundingClientRect()
    const viewport = window.innerHeight || 0
    if (rect.top <= viewport + NEAR_VIEWPORT_MARGIN && rect.bottom >= -NEAR_VIEWPORT_MARGIN) {
      setSkeletonMounted(true)
      return
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setSkeletonMounted(true)
        observer.disconnect()
      }
    }, { rootMargin: `${NEAR_VIEWPORT_MARGIN}px 0px` })
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [expanded, skeletonMounted])
  // The skeleton waits for a scroll pause, then the real body fills in.
  useEffect(() => {
    if (!skeletonMounted || bodyMounted) return
    requestBodyFill(() => { setBodyMounted(true) })
  }, [bodyMounted, skeletonMounted])
  // A single-file expand is a user gesture: mount the body immediately
  // instead of waiting for the pause detector.
  const onHeaderClick = useCallback(() => {
    if (!expanded) setBodyMounted(true)
    onToggle(file.path)
  }, [expanded, file.path, onToggle])
  const hunks = useMemo(() => ready?.layers.reduce((sum, layer) => sum + layer.files.reduce((files, parsed) => (
    files + (parsed.binary ? 0 : parsed.hunks.length)
  ), 0), 0) ?? 0, [ready])
  const skeletonHeight = Math.max(120, Math.min(hunks * 16 + 40, 600))
  return (
    <article ref={anchorRef} className={css.reviewFile} data-review-path={file.path}>
      <button
        type="button"
        className={css.reviewFileHeader}
        aria-expanded={expanded}
        onClick={onHeaderClick}
      >
        <IconChevronDownOutline14 className={expanded ? undefined : css.reviewFileChevronCollapsed} />
        <code className={css.reviewFileState}>{file.index}{file.workingTree}</code>
        <span className={css.reviewFilePath}>{label}</span>
        {pending
          ? <span className={css.reviewFileLoading}>{t('loading')}</span>
          : ready !== null && <span className={css.reviewCounts}><b>{`+${ready.added}`}</b><i>{`-${ready.removed}`}</i></span>}
      </button>
      {expanded && skeletonMounted && !bodyMounted && (
        <div className={css.reviewFileSkeleton} style={{ height: skeletonHeight }} aria-hidden>
          {t('loading')}
        </div>
      )}
      {bodyMounted && (
        <div className={expanded ? css.reviewFileContent : css.reviewFileContentCollapsed} aria-hidden={!expanded}>
          {pending && <div className={css.reviewFileMessage}>{t('loading')}</div>}
          {failed !== null && <div className={css.reviewFileError}>{failed}</div>}
          {ready !== null && ready.layers.map(layer => (
            <section key={layer.kind} className={css.diffLayer}>
              <div className={css.diffLayerTitle}>{layer.kind === 'staged' ? t('review.layer.staged') : t('review.layer.working')}</div>
              {layer.files.map(parsed => (
                parsed.binary
                  ? <div key={parsed.key} className={css.binary}>{t('review.binary')}</div>
                  : <DiffBlock key={parsed.key} diffs={parsed.hunks} showPath={false} showFooter={false} variant="review" />
              ))}
            </section>
          ))}
        </div>
      )}
    </article>
  )
})

export function ReviewPanel({ controller, reveal, visible, contributeHeaderActions, t }: ReviewPanelProps) {
  const cache = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set())
  const [missedPath, setMissedPath] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const expandedRef = useRef(expandedPaths); expandedRef.current = expandedPaths
  const prevVisible = useRef(false)
  /** Whether the current open has already been handled (expand-all or reveal). */
  const openHandled = useRef(false)

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
    const files = cache.status?.files ?? []
    if (files.length === 0) return
    openHandled.current = true
    const next = new Set(files.map(file => file.path))
    expandedRef.current = next
    startTransition(() => { setExpandedPaths(next) })
    // Batch open loads through the sequential queue; ready files mount
    // immediately from the warm caches.
    controller.loadAll(next)
    // Focus the top after the expansion joins the layout.
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>('[data-review-path]')
        ?.scrollIntoView({ block: 'start' })
    })
  }, [cache.status, controller, reveal, visible])

  // A reveal expands and scrolls to the target: the optimistic pass points
  // at a cached file immediately, the silent refresh corrects and re-fetches
  // the focused file. The nonce (command sequence) makes same-path repeats
  // re-fire.
  useEffect(() => {
    if (reveal === undefined) return
    const optimistic = matchReviewFile(cache.status?.files ?? [], reveal.target)
    if (optimistic !== undefined && cache.entries[optimistic] !== undefined) {
      const next = new Set([...expandedRef.current, optimistic])
      expandedRef.current = next
      setExpandedPaths(next)
    }
    void controller.refresh({ focusPath: reveal.target, silent: true }).then((focus) => {
      if (focus === undefined) {
        setMissedPath(reveal.target)
        return
      }
      setMissedPath(null)
      const next = new Set([...expandedRef.current, focus])
      expandedRef.current = next
      setExpandedPaths(next)
      // Scroll after paint: the expansion above must join the layout first.
      requestAnimationFrame(() => {
        const escaped = focus.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
        listRef.current?.querySelector<HTMLElement>(`[data-review-path="${escaped}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }).catch(() => {
      // Reveal refresh failures keep the last good panel; the optimistic
      // expansion above already pointed the user at the file.
    })
  }, [reveal, controller])

  // The controller gates its hidden→visible catch-all refresh on this share.
  useEffect(() => { controller.setVisible(visible !== false) }, [controller, visible])
  // Expansion exempts entries from the controller's cache eviction.
  useEffect(() => { controller.setExpanded(expandedPaths) }, [controller, expandedPaths])

  const toggleFile = useCallback((path: string): void => {
    const opening = !expandedRef.current.has(path)
    const next = new Set(expandedRef.current)
    if (opening) next.add(path)
    else next.delete(path)
    expandedRef.current = next
    setExpandedPaths(next)
    // SWR on expand: a stale cache displays immediately and revalidates.
    if (opening) controller.ensure(path)
  }, [controller])

  // One header action left of the refresh button: expand-all when nothing is
  // expanded, collapse-all otherwise — the icon states swap with the action.
  const anyExpanded = expandedPaths.size > 0
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    right: <>
      <WorkbenchPanelIconButton
        label={anyExpanded ? t('review.collapseAll') : t('review.expandAll')}
        disabled={(cache.status?.files.length ?? 0) === 0}
        onClick={() => {
          const paths = cache.status?.files.map(file => file.path) ?? []
          const next = anyExpanded ? new Set<string>() : new Set(paths)
          expandedRef.current = next
          // Mounting many warmed DiffBlocks is still a large render: mark the
          // expansion as a transition so the UI keeps answering input.
          if (anyExpanded) setExpandedPaths(next)
          else startTransition(() => { setExpandedPaths(next) })
          // Anything not already ready revalidates through the sequential
          // queue — never N concurrent fetches whose sync warm-ups would
          // freeze the frame.
          controller.loadAll(next)
        }}
      >
        {anyExpanded ? <IconUnfoldLessOutline14 /> : <IconUnfoldMoreOutline14 />}
      </WorkbenchPanelIconButton>
      <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { void controller.refresh({ runChecks: true }) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>
    </>
  }), [anyExpanded, cache.status, controller, t])
  usePanelHeaderActions(contributeHeaderActions, headerActions)

  return (
    <div className={css.review}>
      {cache.error !== null && <div className={css.error}>{cache.error}</div>}
      <div className={css.reviewBody}>
        <div className={css.reviewStatus}>
          <strong>{cache.status?.branch || t('review.title')} → {t('review.title')}</strong>
          <span>{cache.checks === null ? '—' : cache.checks.clean ? t('review.checks.clean') : t('review.checks.failed')}</span>
        </div>
        {missedPath !== null && (
          <div className={css.reviewMissed} role="status">{t('review.missedFile')}<code>{missedPath}</code></div>
        )}
        {cache.status?.files.length === 0
          ? <div className={css.reviewPlaceholder}>{t('review.clean')}</div>
          : <div ref={listRef} className={css.fileList} role="list" aria-label={t('review.files')}>
              {cache.status?.files.map(file => {
                const entry = cache.entries[file.path]
                if (entry === undefined) return null
                return (
                  <ReviewFileRow
                    key={file.path}
                    entry={entry}
                    expanded={expandedPaths.has(file.path)}
                    onToggle={toggleFile}
                    t={t}
                  />
                )
              })}
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
