/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import { detectNativeWindowChrome } from './native-window-chrome.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.module.css'

/** Zoom/fullscreen flags pushed by the macOS Electron main process. */
interface DesktopWindowState { maximized: boolean; fullscreen: boolean }
interface DesktopWindowBridge {
  getState(): Promise<DesktopWindowState>
  onStateChange(listener: (state: DesktopWindowState) => void): () => void
  setTitleBarTheme(color: string, symbolColor: string): Promise<void>
}
declare global { interface Window { deepcreatorWindow?: DesktopWindowBridge } }

/** The strip's label mirrors the native window title's transform (main process). */
function stripTitle(title: string): string {
  const replaced = title.replace(/DeepSeek Harness$/, 'DeepCreator').trim()
  return replaced === '' ? 'DeepCreator' : replaced
}

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'deepcreator.stage.apps' | 'deepcreator.shell.sidebar-toggle' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the drag-start origin.
 * `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column frame (see module doc). */
export function AppFrame({
  useStore,
  useSessions,
  actions,
  renderSlot,
  t,
}: AppFrameProps) {
  const panels = useStore(s => s)
  const nativeWindowChrome = detectNativeWindowChrome(window.navigator.userAgent)
  // macOS hides the traffic lights on a maximized or fullscreen window; the
  // frame drops its fixed safe-area avoidance while either flag is set
  // (AppFrame.module.css gates the macOS overrides with these markers).
  const [windowState, setWindowState] = useState<DesktopWindowState>({ maximized: false, fullscreen: false })
  useEffect(() => {
    if (nativeWindowChrome !== 'macos') return
    const bridge = window.deepcreatorWindow
    if (bridge === undefined) return
    let alive = true
    void bridge.getState().then((state) => { if (alive) setWindowState(state) })
    const off = bridge.onStateChange((state) => {
      setWindowState(previous =>
        previous.maximized === state.maximized && previous.fullscreen === state.fullscreen ? previous : state)
    })
    return () => { alive = false; off() }
  }, [nativeWindowChrome])
  const currentSession = useSessions(s => s.current)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  // The Windows title strip mirrors document.title (the same text the main
  // process projects onto the native window title) so the strip stays in
  // step with the session name without another bridge.
  const [titleText, setTitleText] = useState(() => stripTitle(document.title))
  useEffect(() => {
    if (nativeWindowChrome !== 'windows') return
    const titleNode = document.querySelector('title')
    if (titleNode === null) return
    const publish = (): void => { setTitleText(stripTitle(document.title)) }
    const observer = new MutationObserver(publish)
    observer.observe(titleNode, { childList: true, characterData: true, subtree: true })
    return () => { observer.disconnect() }
  }, [nativeWindowChrome])
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  // Track the frame's own box (not the window): rAF-throttled ResizeObserver.
  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Narrow viewports auto-collapse the sidebar; the store mirror keeps
  // toggleSidebar's semantics right (narrow toggles flip the manual
  // re-expand override, stores.ts). Collapsed is decided here, so the
  // solver stays breakpoint-free: a narrow re-expand passes the preference
  // (or the default when the wide preference is closed) and the center
  // absorbs the squeeze.
  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  const phone = viewport <= 640
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  // Stage mode is root-scope transient (the App Stage is a person-scoped
  // desktop): session/workspace switches never leave apps mode and the
  // breakpoint never collapses the dock back to conversation.
  const stageMode = useStore(s => s.stageMode)
  const stageActivity = useStore(s => s.stageActivity)
  const dockOpen = useStore(s => s.dockOpen)
  const dockWidth = useStore(s => s.dockWidth)
  const appsActive = stageMode === 'apps'
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const cols = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  // The desktop concession solver must not decide whether the phone's
  // full-stage Workbench is open: at phone widths it necessarily concedes the
  // third track to zero. The stored preference is the source of truth while
  // the same details subtree is projected over the stage. Apps mode owns the
  // full-stage projection instead (later layer wins), so the phone's own
  // full-stage variant suspends while apps is active.
  const mobileDetailsOpen = phone && !appsActive && detailsSession !== undefined && panels.details > 0
  // Inside apps mode with the dock open, an open details track projects into
  // the dock band (the phone's full-stage projection of the same subtree,
  // shrunk to the band); the Workbench keeps its own open/close semantics.
  const dockDetailsOpen = appsActive && dockOpen && detailsSession !== undefined && panels.details > 0
  const mobileHistoryArmed = useRef(false)
  const appsHistoryArmed = useRef(false)
  const renderedSidebar = phone ? 0 : cols.sidebar
  const renderedDetails = phone ? 0 : cols.details
  const colsRef = useRef(cols)
  colsRef.current = cols
  const centerRef = useRef<HTMLDivElement | null>(null)
  const detailsRef = useRef<HTMLDivElement | null>(null)

  // A phone drawer is navigation chrome, so committing a different Session
  // returns the user to the unchanged Conversation occupant. Desktop keeps
  // the persistent Sidebar behavior, and opening the drawer without changing
  // Session selection does not close it again.
  const previousSession = useRef(currentSession)
  useEffect(() => {
    const changed = previousSession.current !== currentSession
    previousSession.current = currentSession
    if (phone && changed && !sidebarCollapsed) actions.toggleSidebar()
  }, [actions, currentSession, phone, sidebarCollapsed])

  // Both Stage takeovers (the phone's full-stage Workbench and apps mode)
  // participate in one browser-history ledger. Entering pushes a marked
  // entry; the platform back gesture pops back to the previous entry and the
  // popstate listener closes exactly the layer whose marker left the top.
  // A programmatic exit consumes its own top entry with history.back() only
  // when that entry is still on top — another layer pushed later (e.g. the
  // mobile Workbench over apps mode) owns the stack top, and popping it here
  // would close the wrong layer. A leftover buried entry stays harmless: the
  // armed flag is already down, so passing it later triggers nothing.
  useEffect(() => {
    const onPopState = (event: PopStateEvent): void => {
      // The event carries the DESTINATION entry's state (standard popstate
      // semantics); reading window.history.state here would be equivalent in
      // a real browser but wrong for synthetic events, which express "we left
      // the marked entry" with a null state.
      const state = event.state as { deepcreatorMobileWorkbench?: boolean; deepcreatorStageApps?: boolean } | null
      if (mobileHistoryArmed.current && state?.deepcreatorMobileWorkbench !== true) {
        mobileHistoryArmed.current = false
        actions.closeDetails()
      }
      if (appsHistoryArmed.current && state?.deepcreatorStageApps !== true) {
        appsHistoryArmed.current = false
        actions.setStageMode('conversation')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => { window.removeEventListener('popstate', onPopState) }
  }, [actions])
  // Declared BEFORE the mobile-details effect: entering apps mode suspends the
  // phone's full-stage projection, and this ordering pushes the apps entry
  // first, so the mobile effect's stack-top check sees the apps marker (not
  // its own) and leaves its buried entry for the popstate ledger instead of
  // firing a back() that would asynchronously pop the fresh apps entry.
  useEffect(() => {
    if (appsActive && !appsHistoryArmed.current) {
      window.history.pushState({ deepcreatorStageApps: true }, '')
      appsHistoryArmed.current = true
      return
    }
    if (!appsActive && appsHistoryArmed.current) {
      appsHistoryArmed.current = false
      if ((window.history.state as { deepcreatorStageApps?: boolean } | null)?.deepcreatorStageApps === true) window.history.back()
    }
  }, [appsActive])
  useEffect(() => {
    if (mobileDetailsOpen && !mobileHistoryArmed.current) {
      window.history.pushState({ deepcreatorMobileWorkbench: true }, '')
      mobileHistoryArmed.current = true
      return
    }
    if (!mobileDetailsOpen && mobileHistoryArmed.current) {
      mobileHistoryArmed.current = false
      if ((window.history.state as { deepcreatorMobileWorkbench?: boolean } | null)?.deepcreatorMobileWorkbench === true) window.history.back()
    }
  }, [mobileDetailsOpen])
  // Unmount reconciliation: the surfaces disappear with the frame, so a live
  // marked entry must not outlive its layer (a stale top entry would swallow
  // the next back gesture). Buried entries again stay harmless.
  useEffect(() => () => {
    if (appsHistoryArmed.current && (window.history.state as { deepcreatorStageApps?: boolean } | null)?.deepcreatorStageApps === true) window.history.back()
    if (mobileHistoryArmed.current && (window.history.state as { deepcreatorMobileWorkbench?: boolean } | null)?.deepcreatorMobileWorkbench === true) window.history.back()
  }, [])

  // Apps mode covers the Stage above both columns: keep the conversation and
  // the details subtree out of keyboard navigation while they are covered
  // (they stay mounted — state survives, only interaction is suspended). The
  // docked conversation and the dock-band details projection stay reachable.
  useEffect(() => {
    const covered = (element: HTMLDivElement | null, isCovered: boolean): void => {
      if (element === null) return
      if (isCovered) element.setAttribute('inert', '')
      else element.removeAttribute('inert')
    }
    covered(centerRef.current, appsActive && !dockOpen)
    covered(detailsRef.current, appsActive && !dockDetailsOpen)
  }, [appsActive, dockOpen, dockDetailsOpen])

  // The drag base is the rendered width captured at drag start (grabbing a
  // concession-clamped panel must not jump back to the stored preference);
  // it stays frozen for the whole gesture so dx deltas do not compound.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const [detailsResizeStart, setDetailsResizeStart] = useState<number | null>(null)
  // Track-level transitions pause for the whole gesture: eased tracks would
  // detach the column edge from the pointer (AppFrame.module.css).
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => {
    detailsBase.current = colsRef.current.details
    setDetailsResizeStart(colsRef.current.details)
    setDragging(true)
  }, [])
  const onSidebarDrag = useCallback((dx: number) => {
    actions.setSidebar(sidebarBase.current + dx)
  }, [actions])
  const onDetailsDrag = useCallback((dx: number) => {
    actions.setDetails(detailsBase.current - dx)
  }, [actions])
  const onDetailsEnd = useCallback(() => {
    setDragging(false)
    setDetailsResizeStart(null)
  }, [])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{
        gridTemplateColumns: `${renderedSidebar}px minmax(0, 1fr) ${renderedDetails}px`,
        '--dsh-stage-left': `${phone ? 0 : cols.sidebar}px`,
        '--dsh-dock-width': `${dockWidth}px`,
      } as React.CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={(phone ? !mobileDetailsOpen && !dockDetailsOpen : cols.details === 0) || undefined}
      data-dragging={dragging || undefined}
      data-details-focused={panels.detailsFocused || undefined}
      data-stage-mode={stageMode}
      data-dock-open={appsActive && dockOpen || undefined}
      data-dock-details={dockDetailsOpen || undefined}
      data-phone={phone || undefined}
      data-mobile-sidebar-open={phone && !sidebarCollapsed || undefined}
      data-mobile-details-open={mobileDetailsOpen || undefined}
      data-native-window-chrome={nativeWindowChrome}
      data-window-maximized={windowState.maximized || undefined}
      data-window-fullscreen={windowState.fullscreen || undefined}
    >
      {nativeWindowChrome === 'windows' && (
        /* Frame-owned 48px title strip: replaces the hidden native title bar,
           renders beneath the Window Controls Overlay buttons (top-right),
           and is the window's drag surface on Windows. */
        <div className={css.titlebar} data-app-titlebar>
          <span className={css.titlebarText}>{titleText}</span>
        </div>
      )}
      <div className={css.sidebarCol}>
        {/* Render-site slot call with live concession output. The subtree
            remains mounted at zero width so its state survives reopening;
            the external reopen control is seated by the frame below. */}
        {renderSlot('sidebar', {
          collapsed: sidebarCollapsed,
          width: cols.sidebar,
        })}
      </div>
      {phone && !sidebarCollapsed && (
        <button type="button" className={css.mobileSidebarMask} aria-label="Close sidebar" onClick={actions.toggleSidebar} />
      )}
      <>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <div ref={centerRef} className={css.centerCol}>{renderSlot('conversation', {})}</div>
        <div ref={detailsRef} className={css.detailsCol}>{renderSlot('details', {
          width: phone ? viewport : cols.details,
          stageWidth: phone ? viewport : Math.max(0, viewport - cols.sidebar),
          resizeGesture: detailsResizeStart === null
            ? null
            : { active: true, startWidth: detailsResizeStart },
        })}</div>
      </>
      {/* Conversation-mode activity chip (M4): while an agent drives an app
          from the conversation, one visible affordance names the app and
          carries the user straight to the desktop on click. */}
      {stageMode === 'conversation' && stageActivity !== undefined && (
        <button
          type="button"
          className={css.activityChip}
          onClick={() => { actions.setStageMode('apps') }}
          title={t('stage-mode.activity').replace('{name}', stageActivity.name)}
        >
          <span className={css.activityChipDot} aria-hidden="true" />
          {t('stage-mode.activity').replace('{name}', stageActivity.name)}
        </button>
      )}
      {/* The App Stage seat: mounted permanently (root scope), hidden while
          conversation mode owns the Stage. Covering geometry follows the
          details-Focus family — the layer insets over the Stage past the
          Sidebar — and yields its right band to the docked conversation. */}
      <div className={css.appsLayer} data-stage-apps>
        {renderSlot('deepcreator.stage.apps', {
          phone,
          stageWidth: Math.max(0, viewport - (phone ? 0 : cols.sidebar) - (dockOpen ? dockWidth : 0)),
          dockOpen,
        })}
      </div>
      {phone && appsActive && dockOpen && (
        /* Phone dock is an overlay drawer: the mask closes it (the same
           back-gesture-safe close as the sidebar drawer). */
        <button type="button" className={css.dockMask} aria-label="Close conversation dock" onClick={() => { actions.setDockOpen(false) }} />
      )}
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {sidebarCollapsed && (
        <div className={css.sidebarToggleSeat} data-sidebar-toggle-seat>
          {renderSlot('deepcreator.shell.sidebar-toggle', {})}
        </div>
      )}
      {/* A closed zero-width sidebar has no resize handle. */}
      {!phone && !sidebarCollapsed && <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />}
      {!phone && cols.details > 0 && !panels.detailsFocused && (
        <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDetailsEnd} />
      )}
    </div>
  )
}
