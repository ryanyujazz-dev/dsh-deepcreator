/**
 * The App Stage shell — the occupant of ui-layout's `deepcreator.stage.apps`
 * seat. One desktop per person: the launcher aggregates installed apps, the
 * dev menu probes this workspace's `.deepcreator/apps/` on open (M1 refresh
 * semantics; the watcher set arrived in M2), and one sandboxed container
 * (`sandbox="allow-scripts"`, CSP'd static origin) stays physically mounted
 * while the layer is hidden, so leaving apps mode never reloads an app — and
 * (M4) an agent can drive it from conversation mode through the router.
 *
 * The container is router-owned state (user clicks and agent requests
 * converge on one store); the shell renders it, binds the live frame to the
 * router, and keeps view state only.
 *
 * Pure props consumer: host data arrives through the captured remote
 * namespace, layout writes through the injected layout face — never ctx.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AppDevEntry, AppInstalledEntry, AppStageEnsureResult, AppStageListResult } from '@ryanyujazz/dsh-app-stage/types'
import type { ActivityRow, DevMenuRow, LauncherCard, StageShellProps } from './contract.ts'
import type { AppStagePresenceTimelineResult } from '@ryanyujazz/dsh-app-stage/types'
import { PresenceBanner } from './PresenceBanner.tsx'
import css from './StageShell.module.css'

function rowsFrom(entries: readonly AppDevEntry[]): DevMenuRow[] {
  return entries.map(entry => ({
    appId: entry.appId,
    name: entry.manifest?.name ?? entry.appId,
    version: entry.manifest?.version ?? '',
    ready: entry.status === 'ready',
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    conflictsWithInstalled: entry.conflictsWithInstalled,
  }))
}

function cardsFrom(entries: readonly AppInstalledEntry[]): LauncherCard[] {
  return entries
    .filter(entry => entry.status === 'ready' && entry.manifest !== undefined)
    .map(entry => ({
      appId: entry.appId,
      name: entry.manifest!.name,
      version: entry.manifest!.version,
      ...(entry.manifest!.description === undefined ? {} : { description: entry.manifest!.description }),
      ...(entry.updatedSinceOpen === true ? { updated: true } : {}),
      ...(entry.pointer !== undefined && entry.pointer.sourceWorkspace !== '' ? { sourceWorkspace: entry.pointer.sourceWorkspace } : {}),
      ...(entry.pointer !== undefined ? { installedAt: entry.pointer.installedAt } : {}),
    }))
}

/**
 * Render the desktop.
 * @param props - composed occupant props (owner share + locale + faces).
 * @returns the stage shell, or nothing before the seat has geometry.
 */
export function StageShell({ phone, stageWidth, dockOpen, t, layout, sessions, remote, scanTick, activityTick = 0, router, presence }: StageShellProps) {
  const sessionId = useSyncExternalStore(sessions.subscribe, sessions.getSnapshot)
  const [rows, setRows] = useState<readonly DevMenuRow[]>([])
  const [cards, setCards] = useState<readonly LauncherCard[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityRows, setActivityRows] = useState<readonly ActivityRow[]>([])
  const [activityUnread, setActivityUnread] = useState(0)
  const container = useSyncExternalStore(router.subscribe, router.getSnapshot)
  const [opening, setOpening] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const activityRef = useRef<HTMLDivElement | null>(null)

  // Probe-at-open: rescan whenever the menu opens, the session changes, or
  // the shell is asked to refresh (scanTick). No DeepCreator refresh is ever
  // involved — this is a plain host call over the mounted remote.
  useEffect(() => {
    if (sessionId === undefined) {
      setRows([])
      setCards([])
      return
    }
    let cancelled = false
    void remote.list(sessionId).then((wire: RemoteResult<AppStageListResult>) => {
      if (cancelled) return
      if (wire.ok && wire.value.ok) {
        setRows(rowsFrom(wire.value.list.dev))
        setCards(cardsFrom(wire.value.list.installed))
      }
    }).catch(() => { /* probe stays silent: the menu shows its empty state */ })
    return () => { cancelled = true }
  }, [remote, sessionId, scanTick, menuOpen])

  // Activity timeline (M5e): the unread count rides scanTick (blue dot);
  // opening the panel fetches the global installed-origin feed and advances
  // the watermark to its head — one panel, one global feed (presence §3.6).
  useEffect(() => {
    if (sessionId === undefined) { setActivityUnread(0); setActivityRows([]); return }
    let cancelled = false
    void remote.presenceSeen(sessionId).then((wire: RemoteResult<{ ok: true; seen: number; latest: number }>) => {
      if (cancelled || !wire.ok || !wire.value.ok) return
      setActivityUnread(Math.max(0, wire.value.latest - wire.value.seen))
      if (activityOpen) void remote.presenceTimeline(sessionId, 0).then((rowsWire: RemoteResult<AppStagePresenceTimelineResult>) => {
        if (cancelled || !rowsWire.ok || !rowsWire.value.ok) return
        setActivityRows([...rowsWire.value.rows].reverse())
        const head = rowsWire.value.latest
        // Opening the panel is reading the feed: advance the watermark to its
        // head and extinguish the dot immediately (open = seen).
        if (head > wire.value.seen) {
          void remote.presenceMarkSeen(sessionId, head).then((markWire: RemoteResult<{ ok: true; seen: number }>) => {
            if (cancelled || !markWire.ok || !markWire.value.ok) return
            setActivityUnread(Math.max(0, head - markWire.value.seen))
          }).catch(() => { /* silent: next open retries */ })
        } else setActivityUnread(Math.max(0, wire.value.latest - wire.value.seen))
      }).catch(() => { /* silent: next open retries */ })
    }).catch(() => { /* silent: next scan retries */ })
    return () => { cancelled = true }
  }, [remote, sessionId, scanTick, activityTick, activityOpen])

  // Outside-click closes the dev menu (standard dropdown dismissal).
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent): void => {
      if (menuRef.current !== null && event.target instanceof Node && !menuRef.current.contains(event.target)) setMenuOpen(false)
      if (activityRef.current !== null && event.target instanceof Node && !activityRef.current.contains(event.target)) setActivityOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [menuOpen, activityOpen])

  const readyCount = useMemo(() => rows.filter(row => row.ready).length, [rows])

  const openEntry = useCallback((row: DevMenuRow) => {
    if (!row.ready || sessionId === undefined) return
    setError(undefined)
    setOpening(row.appId)
    void remote.ensure(sessionId, `dev:${row.appId}`).then((wire: RemoteResult<AppStageEnsureResult>) => {
      if (wire.ok && wire.value.ok) {
        router.openFromUser({ appId: row.appId, name: row.name, version: row.version, url: wire.value.url, dev: true, ref: `dev:${row.appId}` })
      } else if (wire.ok && !wire.value.ok) {
        setError(wire.value.message)
      } else if (!wire.ok) {
        setError(wire.error.message)
      }
    }).catch(reason => { setError(String(reason)) }).finally(() => { setOpening(undefined) })
  }, [remote, sessionId])

  const backToDesktop = useCallback(() => { router.close() }, [router])

  // Open one installed app: re-gate via ensure (also records the open, which
  // clears the blue dot on the next list), then mount the sandbox container.
  const openInstalled = useCallback((card: LauncherCard) => {
    if (sessionId === undefined) return
    setError(undefined)
    setOpening(card.appId)
    void remote.ensure(sessionId, card.appId).then((wire: RemoteResult<AppStageEnsureResult>) => {
      if (wire.ok && wire.value.ok) {
        router.openFromUser({ appId: card.appId, name: card.name, version: card.version, url: wire.value.url, dev: false, ref: card.appId })
      } else if (wire.ok && !wire.value.ok) {
        setError(wire.value.message)
      } else if (!wire.ok) {
        setError(wire.error.message)
      }
    }).catch(reason => { setError(String(reason)) }).finally(() => { setOpening(undefined) })
  }, [remote, sessionId])

  // Two-step uninstall: arm, confirm, call the host removal, rescan.
  const [armedRemoval, setArmedRemoval] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const uninstallApp = useCallback((card: LauncherCard) => {
    if (sessionId === undefined) return
    setNotice(undefined)
    void remote.uninstall(sessionId, card.appId).then((wire: RemoteResult<{ ok: true; appId: string; removed: true } | { ok: false; code: string; message: string }>) => {
      if (wire.ok && wire.value.ok) {
        setNotice(t('launcher.removed').replace('{name}', card.name))
        return remote.list(sessionId)
      }
      setError(wire.ok && !wire.value.ok ? wire.value.message : wire.ok ? String(wire.value) : wire.error.message)
      return undefined
    }).then(rescan => {
      if (rescan === undefined || !rescan.ok || !rescan.value.ok) return
      setRows(rowsFrom(rescan.value.list.dev))
      setCards(cardsFrom(rescan.value.list.installed))
    }).catch(reason => { setError(String(reason)) }).finally(() => { setArmedRemoval(undefined) })
  }, [remote, sessionId, t])

  // Bind the sandbox bridge to the live container frame: one attach per
  // mount (op relay + the v2 action channel), detached when the container
  // closes or swaps. The key makes a swap a remount, so the callback ref
  // re-runs and the old bridge can never observe a swapped document.
  const containerRef = container?.ref
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const frameCallback = useCallback((frame: HTMLIFrameElement | null) => {
    frameRef.current = frame
  }, [])
  // Bind through an effect, not the callback ref's return value: React 19
  // ignores a cleanup returned from a callback ref, so a bridge attached
  // there never detaches — a remount would stack a second dispatch path on
  // the same frame (double execution of one invoke). The effect tears the
  // binding down on every dependency change and unmount.
  useEffect(() => {
    const frame = frameRef.current
    if (frame === null || containerRef === undefined) return
    return router.bindFrame(containerRef, frame)
  }, [router, containerRef])

  return (
    <div className={css.shell} data-phone={phone || undefined}>
      <header className={css.topBar}>
        <div className={css.titleCluster}>
          {container !== undefined && (
            <button type="button" className={css.backButton} onClick={backToDesktop}>{t('container.back')}</button>
          )}
          <h1 className={css.title}>{t('stage.title')}</h1>
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.toolButton}
            aria-pressed={dockOpen}
            aria-label={dockOpen ? t('dock.toggle.close') : t('dock.toggle.open')}
            title={dockOpen ? t('dock.toggle.close') : t('dock.toggle.open')}
            onClick={() => { layout.setDockOpen(!dockOpen) }}
          >
            <span className={css.dockGlyph} aria-hidden="true">▤</span>
          </button>
          <div className={css.menuAnchor} ref={menuRef}>
            <button
              type="button"
              className={css.toolButton}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen(!menuOpen) }}
            >
              {readyCount > 0 ? t('dev.menu.count').replace('{count}', String(readyCount)) : t('dev.menu')}
              <span className={css.menuCaret} aria-hidden="true">▾</span>
            </button>
            {menuOpen && (
              <div className={css.menu} role="menu">
                {sessionId === undefined && <div className={css.menuHint}>{t('dev.no-session')}</div>}
                {sessionId !== undefined && rows.length === 0 && <div className={css.menuHint}>{t('dev.empty')}</div>}
                {rows.map(row => (
                  <button
                    key={row.appId}
                    type="button"
                    role="menuitem"
                    className={row.ready ? css.menuRow : css.menuRowDim}
                    disabled={!row.ready || opening === row.appId}
                    title={row.ready ? t('dev.open').replace('{name}', row.name) : t('dev.reason').replace('{code}', row.reason?.code ?? '').replace('{detail}', row.reason?.detail ?? '')}
                    onClick={() => { openEntry(row); setMenuOpen(false) }}
                  >
                    <span className={css.menuRowName}>{row.name}</span>
                    {row.version !== '' && <span className={css.menuRowMeta}>v{row.version}</span>}
                    {!row.ready && row.reason !== undefined && (
                      <span className={css.menuRowReason}>{row.reason.code}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={css.menuAnchor} ref={activityRef}>
            <button
              type="button"
              className={css.toolButton}
              aria-haspopup="menu"
              aria-expanded={activityOpen}
              onClick={() => { setActivityOpen(!activityOpen) }}
            >
              {t('activity.menu')}
              {activityUnread > 0 && <span className={css.activityDot} aria-label={String(activityUnread)} />}
            </button>
            {activityOpen && (
              <div className={css.menu} role="menu" aria-label={t('activity.menu')}>
                {sessionId === undefined && <div className={css.menuHint}>{t('dev.no-session')}</div>}
                {sessionId !== undefined && activityRows.length === 0 && <div className={css.menuHint}>{t('activity.empty')}</div>}
                {activityRows.map(row => {
                  const kindKey = `activity.kind.${row.kind}` as Parameters<typeof t>[0]
                  const outcomeKey = `activity.outcome.${row.outcome}` as Parameters<typeof t>[0]
                  return (
                    <div key={row.seq} className={css.activityRow} role="menuitem">
                      <span className={css.activityTime}>{new Date(row.ts).toLocaleTimeString()}</span>
                      <span className={css.activityApp}>{row.appName}</span>
                      <span className={css.activityAction}>{row.action ?? t(kindKey)}</span>
                      <span className={row.outcome === 'ok' ? css.activityOk : css.activityFail}>{t(outcomeKey)}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </header>
      <PresenceBanner feed={presence} t={t} />
      <div className={css.body}>
        {container !== undefined ? (
          <div className={css.containerArea}>
            {container.dev && container.version !== '' && (
              <div className={css.devBadge}>{t('container.dev-badge').replace('{version}', container.version)}</div>
            )}
            <iframe
              key={container.ref}
              ref={frameCallback}
              className={css.frame}
              title={container.name}
              sandbox="allow-scripts"
              src={container.url}
            />
          </div>
        ) : error !== undefined ? (
          <div className={css.empty}>{t('container.failed').replace('{name}', '').replace('{message}', error)}</div>
        ) : cards.length === 0 ? (
          <div className={css.empty}>{notice ?? t('launcher.empty')}</div>
        ) : (
          <div className={css.launcher} style={{ '--stage-width': `${stageWidth}px` } as CSSProperties}>
            {notice !== undefined && <div className={css.launcherNotice} role="status">{notice}</div>}
            {cards.map(card => (
              <div key={card.appId} className={css.cardShell}>
                <button
                  type="button"
                  className={css.card}
                  disabled={opening === card.appId}
                  title={t('launcher.open').replace('{name}', card.name)}
                  onClick={() => { openInstalled(card) }}
                >
                  <span className={css.cardIcon} aria-hidden="true">{card.name.slice(0, 1)}</span>
                  <span className={css.cardName}>{card.name}</span>
                  <span className={css.cardMeta}>v{card.version}</span>
                  {card.sourceWorkspace !== undefined && (
                    <span className={css.cardSource}>{t('launcher.source').replace('{workspace}', card.sourceWorkspace)}</span>
                  )}
                </button>
                {card.updated === true && <span className={css.cardDot} title={t('launcher.updated')} aria-label={t('launcher.updated')} />}
                <button
                  type="button"
                  className={css.cardRemove}
                  aria-label={t('launcher.remove').replace('{name}', card.name)}
                  title={armedRemoval === card.appId ? t('launcher.remove.confirm').replace('{name}', card.name) : t('launcher.remove').replace('{name}', card.name)}
                  aria-pressed={armedRemoval === card.appId}
                  onClick={() => {
                    if (armedRemoval === card.appId) uninstallApp(card)
                    else setArmedRemoval(card.appId)
                  }}
                  onBlur={() => { if (armedRemoval === card.appId) setArmedRemoval(undefined) }}
                >
                  {armedRemoval === card.appId ? '!' : '×'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
