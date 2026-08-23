import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPanelInfoContribution, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type { BrowserClientRuntime, BrowserSurfaceBridge } from './runtime.ts'
import css from './BrowserPanel.module.css'

interface Rect { x: number; y: number; width: number; height: number }
declare global { interface Window { deepcreatorBrowserSurface?: BrowserSurfaceBridge } }
type Props = WorkbenchPanelProps & PropsLocale<'browser'> & { browser: BrowserClientRuntime }

function rect(element: HTMLElement): Rect { const value = element.getBoundingClientRect(); return { x: Math.round(value.x), y: Math.round(value.y), width: Math.max(0, Math.round(value.width)), height: Math.max(0, Math.round(value.height)) } }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }

function LiveSurface({ browser, tabId, surfaceId, visible, label }: { browser: BrowserClientRuntime; tabId: string; surfaceId: string; visible: boolean; label: string }) {
  const host = useRef<HTMLDivElement | null>(null); const mountedSurface = useRef<string | undefined>(undefined); const visibleState = useRef(visible); const bridge = window.deepcreatorBrowserSurface
  visibleState.current = visible
  useEffect(() => {
    const element = host.current
    if (element === null || bridge === undefined) return
    let disposed = false
    const fail = (error: unknown) => { if (!disposed) browser.surfaceMountFailed(tabId, errorMessage(error)) }
    const update = () => { if (mountedSurface.current === surfaceId) void bridge.setBounds(surfaceId, rect(element)).catch(fail) }
    browser.surfaceMountStarted(tabId)
    void bridge.mount(surfaceId, rect(element)).then(async () => {
      if (disposed) { await bridge.unmount(surfaceId).catch(() => undefined); return }
      mountedSurface.current = surfaceId
      // The Workbench may finish its topology/layout transition while Electron is mounting.
      // Re-read the anchor after mount so the native viewport never keeps the stale first rect.
      await bridge.setBounds(surfaceId, rect(element))
      await bridge.setVisible(surfaceId, visibleState.current)
      if (!disposed) browser.surfaceMounted(tabId)
    }).catch(fail)
    const observer = new ResizeObserver(update); observer.observe(element); addEventListener('resize', update); addEventListener('scroll', update, true)
    return () => { disposed = true; mountedSurface.current = undefined; observer.disconnect(); removeEventListener('resize', update); removeEventListener('scroll', update, true); browser.surfaceUnmounted(tabId); void bridge.unmount(surfaceId).catch(() => undefined) }
  }, [bridge, browser, surfaceId, tabId])
  useEffect(() => { if (bridge !== undefined && mountedSurface.current === surfaceId) void bridge.setVisible(surfaceId, visible).catch(error => browser.surfaceMountFailed(tabId, errorMessage(error))) }, [bridge, browser, surfaceId, tabId, visible])
  return bridge === undefined ? <div className={css.empty}>{label}</div> : <div ref={host} className={css.surface} />
}

export function BrowserPanel({ browser, route, activeInstanceId, openInstance, contributePanelInfo, visible = false, t }: Props) {
  const snapshot = useSyncExternalStore(browser.subscribe, browser.getSnapshot, browser.getSnapshot)
  const states = snapshot.state.tabs
  const labels = useMemo(() => Object.fromEntries(states.map(tab => [tab.tabId, tab.title || tab.url || tab.tabId])), [states])
  const info = useMemo<WorkbenchPanelInfoContribution>(() => ({ tabLabels: labels }), [labels])
  useEffect(() => contributePanelInfo(info), [contributePanelInfo, info])
  const active = states.find(tab => tab.tabId === activeInstanceId)
  if (snapshot.error !== undefined) return <div className={css.root}><div className={css.empty}>{t('unavailable')}: {snapshot.error}</div></div>
  if (route === 'home' || activeInstanceId === undefined) return <div className={css.root}>{states.length === 0 ? <div className={css.empty}>{t('empty')}</div> : <div className={css.tabs}>{states.map(tab => <button key={tab.tabId} type="button" className={css.tab} onClick={() => openInstance(tab.tabId)}>{tab.title || tab.url || tab.tabId}</button>)}</div>}</div>
  if (active === undefined) return <div className={css.root}><div className={css.empty}>{t('stale')}</div></div>
  return <div className={css.root}>
    <div className={css.status}><span>{active.loading ? t('loading') : active.presentation === 'snapshot' ? t('background') : t('browser')}</span><span className={css.url} title={active.url}>{active.url}</span></div>
    {active.presentation === 'live' && active.surfaceId !== undefined
      ? <LiveSurface browser={browser} tabId={active.tabId} surfaceId={active.surfaceId} visible={visible} label={t('liveUnavailable')} />
      : active.snapshotImageDataUrl === undefined ? <div className={css.empty}>{t('snapshotEmpty')}</div> : <div className={css.surface}><img className={css.snapshot} src={active.snapshotImageDataUrl} alt={active.title || active.url} /></div>}
    {active.lastAction === undefined ? null : <div className={css.timeline}>{active.lastAction.action} · {active.lastAction.result}</div>}
  </div>
}
