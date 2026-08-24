import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseOutline16, IconPlusOutline16, WorkbenchPanelIconButton } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelHeaderContribution, WorkbenchPanelInfoContribution, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type { BrowserClientRuntime, BrowserSurfaceBridge } from './runtime.ts'
import css from './BrowserPanel.module.css'

interface Rect { x: number; y: number; width: number; height: number }
declare global { interface Window { deepcreatorBrowserSurface?: BrowserSurfaceBridge } }
type Props = WorkbenchPanelProps & PropsLocale<'browser'> & { browser: BrowserClientRuntime; createTab(): Promise<string> }

function rect(element: HTMLElement): Rect { const value = element.getBoundingClientRect(); return { x: Math.round(value.x), y: Math.round(value.y), width: Math.max(0, Math.round(value.width)), height: Math.max(0, Math.round(value.height)) } }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function normalizeAddress(value: string): string {
  const trimmed = value.trim()
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`
  return `https://${trimmed}`
}

function AddressBar({ browser, tabId, url, placeholder, label, onError }: {
  browser: BrowserClientRuntime; tabId: string; url: string; placeholder: string; label: string; onError(message?: string): void
}) {
  const [draft, setDraft] = useState(url)
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(url), [tabId, url])
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || draft.trim() === '') return
    setBusy(true); onError(undefined)
    void browser.navigateTab(tabId, normalizeAddress(draft)).catch(error => onError(errorMessage(error))).finally(() => setBusy(false))
  }
  return <form className={css.addressBar} onSubmit={submit}>
    <input
      className={css.addressInput}
      aria-label={label}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      disabled={busy}
      onChange={event => setDraft(event.currentTarget.value)}
    />
  </form>
}

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

export function BrowserPanel({ browser, createTab, route, tabs, activeInstanceId, openInstance, closeInstance, contributeHeaderActions, contributePanelInfo, visible = false, t }: Props) {
  const snapshot = useSyncExternalStore(browser.subscribe, browser.getSnapshot, browser.getSnapshot)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const states = snapshot.state.tabs
  const labels = useMemo(() => Object.fromEntries(states.map(tab => [tab.tabId, tab.title || tab.url || tab.tabId])), [states])
  const info = useMemo<WorkbenchPanelInfoContribution>(() => ({ tabLabels: labels }), [labels])
  useEffect(() => contributePanelInfo(info), [contributePanelInfo, info])
  const handleCreate = useCallback(() => {
    if (creating) return
    setCreating(true); setActionError(undefined)
    // Presentation owns materialization and Surface readiness. Once that
    // transaction succeeds, the originating Workbench action commits the
    // exact logical instance locally as well, so one click never leaves the
    // user on Home with only a newly-added row.
    void createTab().then(tabId => openInstance(tabId)).catch(error => setActionError(errorMessage(error))).finally(() => setCreating(false))
  }, [createTab, creating, openInstance])
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => route === 'home' ? {
    left: <WorkbenchPanelIconButton label={t('newTab')} disabled={creating} onClick={handleCreate}><IconPlusOutline16 size={14} /></WorkbenchPanelIconButton>,
  } : {}, [creating, handleCreate, route, t])
  useEffect(() => contributeHeaderActions(headerActions), [contributeHeaderActions, headerActions])
  const active = states.find(tab => tab.tabId === activeInstanceId)
  if (snapshot.error !== undefined) return <div className={css.root}><div className={css.empty}>{t('unavailable')}: {snapshot.error}</div></div>
  if (route === 'home' || activeInstanceId === undefined) return <div className={css.root}>
    {actionError === undefined ? null : <div className={css.error}>{actionError}</div>}
    {states.length === 0 ? <div className={css.empty}>{t('empty')}</div> : <div className={css.tabs}>{states.map(tab => <div key={tab.tabId} className={css.tabRow}>
      <button type="button" className={css.tab} onClick={() => openInstance(tab.tabId)}>{tab.title || tab.url || t('newTab')}</button>
      <button
        type="button"
        className={css.closeTab}
        aria-label={`${t('closeTab')}: ${tab.title || tab.url || t('newTab')}`}
        title={t('closeTab')}
        onClick={() => {
          setActionError(undefined)
          if (tabs.includes(tab.tabId)) closeInstance(tab.tabId)
          else void browser.closeTab(tab.tabId).catch(error => setActionError(errorMessage(error)))
        }}
      ><IconCloseOutline16 size={14} /></button>
    </div>)}</div>}
  </div>
  if (active === undefined) return <div className={css.root}><div className={css.empty}>{browser.hasCurrentSessionSnapshot() ? t('stale') : t('loading')}</div></div>
  const snapshotError = snapshot.snapshotErrors[active.tabId]
  return <div className={css.root}>
    {actionError === undefined ? null : <div className={css.error}>{actionError}</div>}
    <div className={css.status}><span>{active.loading ? t('loading') : active.presentation === 'snapshot' ? t('background') : t('browser')}</span>
      {active.presentation === 'live' && active.surfaceId !== undefined
        ? <AddressBar browser={browser} tabId={active.tabId} url={active.url} placeholder={t('addressPlaceholder')} label={t('addressLabel')} onError={setActionError} />
        : <span className={css.url} title={active.url}>{active.url}</span>}
    </div>
    {active.presentation === 'live' && active.surfaceId !== undefined
      ? <LiveSurface browser={browser} tabId={active.tabId} surfaceId={active.surfaceId} visible={visible} label={t('liveUnavailable')} />
      : active.snapshotImageDataUrl !== undefined ? <div className={css.surface}><img className={css.snapshot} src={active.snapshotImageDataUrl} alt={active.title || active.url} /></div>
        : active.snapshotAttachment === undefined ? <div className={css.empty}>{t('snapshotEmpty')}</div>
          : snapshotError === undefined ? <div className={css.empty}>{t('snapshotLoading')}</div>
            : <div className={css.empty}><div className={css.previewFailure}><span>{t('snapshotFailed')}: {snapshotError}</span><button type="button" className={css.retry} onClick={() => { void browser.retrySnapshot(active.tabId) }}>{t('retry')}</button></div></div>}
    {active.lastAction === undefined ? null : <div className={css.timeline}>{active.lastAction.action} · {active.lastAction.result}</div>}
  </div>
}
