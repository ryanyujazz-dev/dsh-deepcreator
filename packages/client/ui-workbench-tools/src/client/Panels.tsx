import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArtifactRecord } from '@ryanyujazz/dsh-artifacts/types'
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import type { ReviewChecksResult, ReviewDiffResult, ReviewStatusResult } from '@ryanyujazz/dsh-review/types'
import type {} from '@ryanyujazz/dsh-review/remote'
import type { TerminalSessionView } from '@ryanyujazz/dsh-terminal-workbench/types'
import type {} from '@ryanyujazz/dsh-terminal-workbench/remote'
import type {
  WorkbenchPanelHeaderContribution, WorkbenchPanelProps,
} from '@ryanyujazz/dsh-client-ui-workbench/client'
import {
  IconPlusOutline16, IconRefreshOutline14, IconStopFill16, IconTrashOutline16,
  WorkbenchPanelIconButton,
} from '@ryanyujazz/dsh-client-ui-primitives'
import css from './Panels.module.css'
import { TerminalEmulator } from './TerminalEmulator.tsx'

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

export function ReviewPanel({ remote, sessionId, contributeHeaderActions, t }: RemoteProps) {
  const [status, setStatus] = useState<Extract<ReviewStatusResult, { ok: true }> | null>(null)
  const [checks, setChecks] = useState<Extract<ReviewChecksResult, { ok: true }> | null>(null)
  const [diff, setDiff] = useState<Extract<ReviewDiffResult, { ok: true }> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const [statusWire, checksWire] = await Promise.all([remote.review.status(sessionId), remote.review.checks(sessionId)])
    if (!statusWire.ok) throw transportError(statusWire)
    if (!checksWire.ok) throw transportError(checksWire)
    if (!statusWire.value.ok) throw new Error(statusWire.value.message)
    if (!checksWire.value.ok) throw new Error(checksWire.value.message)
    setStatus(statusWire.value); setChecks(checksWire.value); setError(null)
  }, [remote, sessionId])
  useEffect(() => { void refresh().catch(reason => { setError(reason instanceof Error ? reason.message : String(reason)) }) }, [refresh])
  const select = async (path: string) => {
    const wire = await remote.review.diff(sessionId, path)
    if (!wire.ok) throw transportError(wire)
    if (!wire.value.ok) throw new Error(wire.value.message)
    setDiff(wire.value); setError(null)
  }
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    right: <WorkbenchPanelIconButton label={t('refresh')} onClick={() => { void refresh().catch(reason => { setError(String(reason)) }) }}><IconRefreshOutline14 /></WorkbenchPanelIconButton>,
  }), [refresh, t])
  usePanelHeaderActions(contributeHeaderActions, headerActions)
  return (
    <div className={css.review}>
      {error !== null && <div className={css.error}>{error}</div>}
      <div className={css.reviewBody}>
        <nav className={css.fileList} aria-label={t('review.files')}>
          <div className={css.reviewStatus}><strong>{status?.branch || t('review.title')}</strong><span>{checks === null ? '—' : checks.clean ? t('review.checks.clean') : t('review.checks.failed')}</span></div>
          {status?.files.map(file => <button type="button" key={file.path} onClick={() => { void select(file.path).catch(reason => { setError(String(reason)) }) }}><code>{file.index}{file.workingTree}</code><span>{file.path}</span></button>)}
        </nav>
        <pre className={css.diff}>{diff?.diff || (status?.files.length === 0 ? t('review.clean') : t('review.select'))}</pre>
      </div>
    </div>
  )
}

export function TerminalPanel({ terminal, useSessions, sessionId, route, tabs, activeInstanceId, openInstance, contributeHeaderActions, t }: TerminalProps) {
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

  const previousTabs = useRef<readonly string[]>(tabs)
  useEffect(() => {
    for (const id of previousTabs.current) {
      if (!tabs.includes(id) && window.confirm(t('terminal.closePrompt'))) void terminal.kill(sessionId, id)
    }
    previousTabs.current = tabs
  }, [sessionId, tabs, t, terminal])

  const spawn = useCallback(async () => {
    const type = backends[0]
    if (type === undefined) throw new Error(t('terminal.noBackend'))
    const wire = await terminal.spawn(sessionId, { type, name: 'Workbench' })
    if (!wire.ok) throw transportError(wire)
    if (!wire.value.ok) throw new Error(wire.value.message)
    openInstance(wire.value.session.sessionId); await refresh()
  }, [backends, openInstance, refresh, sessionId, t, terminal])
  const handleTerminalExit = useCallback(() => { void refresh() }, [refresh])
  const headerActions = useMemo<WorkbenchPanelHeaderContribution>(() => ({
    left: <WorkbenchPanelIconButton label={t('terminal.new')} disabled={addressed || backends.length === 0} onClick={() => { void spawn().catch(reason => { setError(String(reason)) }) }}><IconPlusOutline16 size={14} /></WorkbenchPanelIconButton>,
    ...(route === 'instance' && activeInstanceId !== undefined
      ? {
          right: <>
            <WorkbenchPanelIconButton label="SIGINT" onClick={() => {
              const active = sessions.find(item => item.sessionId === activeInstanceId)
              const operation = active?.interactive === true
                ? terminal.input(sessionId, activeInstanceId, '\u0003')
                : terminal.signal(sessionId, activeInstanceId, 'SIGINT')
              void operation.catch(() => undefined)
            }}><IconStopFill16 size={14} /></WorkbenchPanelIconButton>
            <WorkbenchPanelIconButton label={t('terminal.kill')} onClick={() => { void terminal.kill(sessionId, activeInstanceId).then(() => { void refresh() }) }}><IconTrashOutline16 size={14} /></WorkbenchPanelIconButton>
          </>,
        }
      : {}),
  }), [activeInstanceId, addressed, backends.length, refresh, route, sessionId, sessions, spawn, t, terminal])
  usePanelHeaderActions(contributeHeaderActions, headerActions)
  if (addressed) return <Empty title={t('terminal')} body={t('terminal.unavailable')} />
  if (route !== 'instance' || activeInstanceId === undefined) {
    return <div className={css.tool}>{error !== null && <div className={css.error}>{error}</div>}<div className={css.list}>{sessions.map(item => <button type="button" key={item.sessionId} onClick={() => { openInstance(item.sessionId) }}><span><strong>{item.shell ?? item.name ?? item.type}</strong><small>{item.cwd ?? item.status.kind}</small></span><code>{item.status.kind}</code></button>)}</div></div>
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
