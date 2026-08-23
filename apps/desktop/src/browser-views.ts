import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { BrowserNetworkPolicy, BrowserRuntimeError, INTERACTIVE_SNAPSHOT_SCRIPT, resolveWorkspaceUpload } from '@ryanyujazz/dsh-browser'
import type { BrowserCommand, BrowserCommandResult, BrowserLocator, BrowserNodeRef, ProviderTab, UserTabCandidate } from '@ryanyujazz/dsh-browser/types'
import type { IabRpcNotification } from '@ryanyujazz/dsh-browser-iab'
import { BrowserWindow, WebContentsView, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { browserPanelFitZoom, normalizeBrowserViewBounds, type BrowserViewBounds } from './browser-view-policy.ts'

export const BROWSER_SURFACE_CHANNELS = {
  mount: 'deepcreator:browser-surface:mount', bounds: 'deepcreator:browser-surface:bounds',
  visible: 'deepcreator:browser-surface:visible', unmount: 'deepcreator:browser-surface:unmount',
  userInput: 'deepcreator:browser-surface:user-input',
} as const

interface SurfaceRecord {
  providerTabId: string; surfaceId: string; view: WebContentsView; ownerAutomationSessionId?: string
  revision: number; mounted: boolean; interruptSerial: number; fitSerial: number
  snapshot?: { snapshotId: string; selectors: Map<string, string> }
}
interface DownloadResult { artifactId: string; fileName: string }
function allowedProtocol(raw: string): boolean { try { const p = new URL(raw).protocol; return p === 'http:' || p === 'https:' } catch { return false } }

/** Electron Main owns all IAB pages and automation. Renderer access is surface geometry only. */
export class BrowserSurfaceDriver {
  readonly #tabs = new Map<string, SurfaceRecord>()
  readonly #surfaceToTab = new Map<string, string>()
  readonly #disposers: Array<() => void> = []
  readonly #network = new BrowserNetworkPolicy()
  readonly #partition = 'persist:deepcreator-browser-iab-v1'
  readonly #browserSession = session.fromPartition(this.#partition, { cache: true })
  readonly #downloads = new Map<number, (result: DownloadResult) => void>()
  #notify: (notification: IabRpcNotification) => void = () => {}
  constructor(private readonly window: BrowserWindow) {}
  setNotificationSink(sink: (notification: IabRpcNotification) => void): void { this.#notify = sink }

  async install(): Promise<void> {
    await mkdir(this.#downloadRoot(), { recursive: true, mode: 0o700 })
    const invoke = <T extends unknown[]>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: T) => unknown) => {
      ipcMain.handle(channel, handler); this.#disposers.push(() => ipcMain.removeHandler(channel))
    }
    invoke<[string, BrowserViewBounds]>(BROWSER_SURFACE_CHANNELS.mount, (event, id, bounds) => { this.#assertMainRenderer(event); this.mount(id, bounds) })
    invoke<[string, BrowserViewBounds]>(BROWSER_SURFACE_CHANNELS.bounds, (event, id, bounds) => { this.#assertMainRenderer(event); this.setBounds(id, bounds) })
    invoke<[string, boolean]>(BROWSER_SURFACE_CHANNELS.visible, (event, id, visible) => { this.#assertMainRenderer(event); this.setVisible(id, visible) })
    invoke<[string]>(BROWSER_SURFACE_CHANNELS.unmount, (event, id) => { this.#assertMainRenderer(event); this.unmount(id) })
    const input = (event: IpcMainEvent, surfaceId: string) => {
      const record = this.#recordBySurface(surfaceId)
      if (record.view.webContents !== event.sender) return
      record.interruptSerial++
      this.#notify({ event: 'control-interrupted', params: { surfaceId } })
    }
    ipcMain.on(BROWSER_SURFACE_CHANNELS.userInput, input)
    this.#disposers.push(() => ipcMain.removeListener(BROWSER_SURFACE_CHANNELS.userInput, input))
    this.#browserSession.webRequest.onBeforeRequest((details, callback) => {
      if (!allowedProtocol(details.url)) { callback({ cancel: true }); return }
      void this.#network.assertAllowed(details.url).then(() => callback({ cancel: false }), () => callback({ cancel: true }))
    })
    this.#browserSession.on('will-download', (_event, item, contents) => {
      const artifactId = `browser-download-${randomUUID()}`; const fileName = basename(item.getFilename())
      item.setSavePath(join(this.#downloadRoot(), `${artifactId}-${fileName}`))
      item.once('done', (_done, state) => { const done = this.#downloads.get(contents.id); this.#downloads.delete(contents.id); if (state === 'completed') done?.({ artifactId, fileName }) })
    })
  }

  async dispatch(method: string, raw: unknown): Promise<unknown> {
    const p = raw as Record<string, unknown>
    if (method === 'createTab') return this.createTab(String(p.automationSessionId), p.request as { url?: string })
    if (method === 'listAgentTabs') return this.listAgentTabs(String(p.automationSessionId))
    if (method === 'listUserTabs') return this.listUserTabs()
    if (method === 'claimUserTab') return this.claimUserTab(String(p.automationSessionId), p.candidate as UserTabCandidate)
    if (method === 'execute') return this.execute(String(p.automationSessionId), String(p.providerTabId), p.command as BrowserCommand, String(p.workspaceRoot))
    if (method === 'release') { this.release(String(p.automationSessionId), String(p.providerTabId)); return null }
    if (method === 'close') { this.close(String(p.automationSessionId), String(p.providerTabId)); return null }
    if (method === 'clearData') { await this.clearData(); return null }
    throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `Unknown IAB method ${method}.`)
  }

  async createTab(automationSessionId: string, request: { url?: string }): Promise<ProviderTab> {
    const providerTabId = randomUUID(); const surfaceId = randomUUID()
    const view = new WebContentsView({ webPreferences: {
      partition: this.#partition, preload: join(import.meta.dirname, 'browser-surface-preload.cjs'),
      additionalArguments: [`--deepcreator-surface-id=${surfaceId}`], sandbox: true, contextIsolation: true, webSecurity: true, nodeIntegration: false,
    } })
    const record: SurfaceRecord = { providerTabId, surfaceId, view, ownerAutomationSessionId: automationSessionId, revision: 0, mounted: false, interruptSerial: 0, fitSerial: 0 }
    this.#tabs.set(providerTabId, record); this.#surfaceToTab.set(surfaceId, providerTabId)
    const changed = () => { record.revision++; this.#notify({ event: 'state-changed', params: { surfaceId, providerTabId } }) }
    view.webContents.on('did-start-loading', changed)
    view.webContents.on('did-stop-loading', () => { changed(); if (record.mounted) void this.#fitPageToSurface(record) })
    view.webContents.on('page-title-updated', changed); view.webContents.on('did-navigate', changed); view.webContents.on('render-process-gone', changed)
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    try { if (request.url !== undefined) { await this.#network.assertAllowed(request.url); await view.webContents.loadURL(request.url) } }
    catch (error) { this.#tabs.delete(providerTabId); this.#surfaceToTab.delete(surfaceId); view.webContents.close(); throw error }
    return this.#state(record)
  }
  listAgentTabs(owner: string): ProviderTab[] { return [...this.#tabs.values()].filter(r => r.ownerAutomationSessionId === owner).map(r => this.#state(r)) }
  listUserTabs(): UserTabCandidate[] { return [...this.#tabs.values()].filter(r => r.ownerAutomationSessionId === undefined).map(r => ({ ...this.#state(r), revision: r.revision })) }
  claimUserTab(owner: string, candidate: UserTabCandidate): ProviderTab {
    const record = this.#tab(candidate.providerTabId); const current = this.#state(record)
    if (record.ownerAutomationSessionId !== undefined || record.revision !== candidate.revision || current.url !== candidate.url || current.title !== candidate.title) throw new BrowserRuntimeError('TAB_NOT_OWNED', 'The user tab changed after it was listed; request a fresh candidate.')
    record.ownerAutomationSessionId = owner; return current
  }

  async execute(owner: string, providerTabId: string, command: BrowserCommand, workspaceRoot: string): Promise<BrowserCommandResult> {
    const record = this.#owned(owner, providerTabId); const serial = record.interruptSerial
    if (command.kind === 'navigate') {
      if (command.action === 'goto') { if (command.url === undefined) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'goto requires URL.'); await this.#network.assertAllowed(command.url); await record.view.webContents.loadURL(command.url) }
      else if (command.action === 'back') record.view.webContents.goBack()
      else if (command.action === 'forward') record.view.webContents.goForward()
      else record.view.webContents.reload()
      this.#assertNotInterrupted(record, serial); return { kind: 'state', tab: this.#state(record) }
    }
    if (command.kind === 'inspect') {
      if (command.action === 'snapshot') return this.#snapshot(record)
      if (command.action === 'screenshot') { const image = await record.view.webContents.capturePage(); return { kind: 'screenshot', dataUrl: image.toDataURL(), tab: this.#state(record) } }
      if (command.action === 'elementInfo') { if (command.locator === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', 'elementInfo requires locator.'); return { kind: 'elementInfo', element: await this.#elementInfo(record, command.locator), tab: this.#state(record) } }
      return { kind: 'state', tab: this.#state(record) }
    }
    if (command.kind === 'wait') { await this.#wait(record, command, serial); return { kind: 'state', tab: this.#state(record) } }
    const locator = command.locator === undefined ? undefined : this.#locatorPayload(record, command.locator)
    const pendingDownload = command.expected === 'download' ? new Promise<DownloadResult>(done => this.#downloads.set(record.view.webContents.id, done)) : undefined
    if (command.action === 'upload') {
      if (locator === undefined || typeof locator.selector !== 'string') throw new BrowserRuntimeError('STALE_SNAPSHOT', 'IAB upload requires a snapshot node locator.')
      const files = await Promise.all((command.files ?? []).map(path => resolveWorkspaceUpload(workspaceRoot, path)))
      const api = record.view.webContents.debugger; if (!api.isAttached()) api.attach('1.3')
      const document = await api.sendCommand('DOM.getDocument') as { root: { nodeId: number } }
      const queried = await api.sendCommand('DOM.querySelector', { nodeId: document.root.nodeId, selector: locator.selector }) as { nodeId: number }
      await api.sendCommand('DOM.setFileInputFiles', { nodeId: queried.nodeId, files })
    } else {
      const destination = command.destination === undefined ? undefined : this.#locatorPayload(record, command.destination)
      await record.view.webContents.executeJavaScript(`(${ACTION_SCRIPT})(${JSON.stringify({ locator, destination, action: command.action, value: command.value ?? '' })})`, true)
    }
    if (command.expected === 'navigation') await this.#waitLoad(record, 30_000, serial)
    this.#assertNotInterrupted(record, serial)
    if (pendingDownload !== undefined) { const download = await Promise.race([pendingDownload, this.#timeout<DownloadResult>(30_000, 'Download timed out.')]); return { kind: 'download', ...download, tab: this.#state(record) } }
    return { kind: 'state', tab: this.#state(record) }
  }

  release(owner: string, id: string): void { delete this.#owned(owner, id).ownerAutomationSessionId }
  close(owner: string, id: string): void { const r = this.#owned(owner, id); this.#tabs.delete(id); this.#surfaceToTab.delete(r.surfaceId); if (r.mounted) this.window.contentView.removeChildView(r.view); r.view.webContents.close() }
  mount(id: string, bounds: BrowserViewBounds): void { const r = this.#recordBySurface(id); if (!r.mounted) { this.window.contentView.addChildView(r.view); r.mounted = true } r.view.setBounds(normalizeBrowserViewBounds(bounds)); r.view.setVisible(true); void this.#fitPageToSurface(r) }
  setBounds(id: string, bounds: BrowserViewBounds): void { const r = this.#recordBySurface(id); r.view.setBounds(normalizeBrowserViewBounds(bounds)); void this.#fitPageToSurface(r) }
  setVisible(id: string, visible: boolean): void { this.#recordBySurface(id).view.setVisible(visible) }
  unmount(id: string): void { const r = this.#recordBySurface(id); if (!r.mounted) return; r.fitSerial++; r.view.setVisible(false); this.window.contentView.removeChildView(r.view); r.mounted = false }
  async clearData(): Promise<void> {
    for (const r of this.#tabs.values()) { if (r.mounted) this.window.contentView.removeChildView(r.view); r.view.webContents.close() }
    this.#tabs.clear(); this.#surfaceToTab.clear(); this.#downloads.clear()
    await Promise.all([this.#browserSession.clearCache(), this.#browserSession.clearStorageData()])
  }
  dispose(): void { for (const dispose of this.#disposers.splice(0)) dispose(); for (const r of this.#tabs.values()) { if (r.mounted) this.window.contentView.removeChildView(r.view); r.view.webContents.close() } this.#tabs.clear(); this.#surfaceToTab.clear(); this.#downloads.clear() }

  #state(r: SurfaceRecord): ProviderTab { const c = r.view.webContents; return { providerTabId: r.providerTabId, surfaceId: r.surfaceId, url: c.getURL(), title: c.getTitle(), loading: c.isLoading(), canGoBack: c.canGoBack(), canGoForward: c.canGoForward() } }
  async #fitPageToSurface(r: SurfaceRecord): Promise<void> {
    const contents = r.view.webContents
    if (!r.mounted || contents.isDestroyed() || contents.getURL() === '') return
    const serial = ++r.fitSerial
    try {
      contents.setZoomFactor(1)
      const metrics = await contents.executeJavaScript(`(()=>{const root=document.documentElement,body=document.body;return{viewportWidth:Math.max(1,root?.clientWidth||innerWidth||1),contentWidth:Math.max(root?.scrollWidth||0,body?.scrollWidth||0)}})()`, true) as { viewportWidth: number; contentWidth: number }
      if (serial !== r.fitSerial || !r.mounted || contents.isDestroyed()) return
      contents.setZoomFactor(browserPanelFitZoom(metrics.viewportWidth, metrics.contentWidth))
    } catch { /* Navigation or teardown can invalidate the document between measurements. */ }
  }
  #tab(id: string): SurfaceRecord { const r = this.#tabs.get(id); if (r === undefined || r.view.webContents.isDestroyed()) throw new BrowserRuntimeError('TAB_NOT_FOUND', `IAB tab ${id} is gone.`); return r }
  #owned(owner: string, id: string): SurfaceRecord { const r = this.#tab(id); if (r.ownerAutomationSessionId !== owner) throw new BrowserRuntimeError('TAB_NOT_OWNED', `IAB tab ${id} is not leased to this automation session.`); return r }
  #recordBySurface(id: string): SurfaceRecord { const tab = this.#surfaceToTab.get(id); if (tab === undefined) throw new BrowserRuntimeError('TAB_NOT_FOUND', `Surface ${id} is gone.`); return this.#tab(tab) }
  #assertMainRenderer(event: IpcMainInvokeEvent): void { if (event.sender !== this.window.webContents) throw new Error('Browser Surface IPC denied for foreign renderer.') }
  #assertNotInterrupted(r: SurfaceRecord, serial: number): void { if (r.interruptSerial !== serial) throw new BrowserRuntimeError('CONTROL_INTERRUPTED', 'User input interrupted the active Browser command.') }
  #downloadRoot(): string { return join(process.env.DSH_HOME ?? join(process.cwd(), '.deepcreator'), 'browser', 'iab', 'artifacts') }

  async #snapshot(r: SurfaceRecord): Promise<BrowserCommandResult> {
    const snapshotId = `snapshot-${randomUUID()}`
    const rows = await r.view.webContents.executeJavaScript(`(${INTERACTIVE_SNAPSHOT_SCRIPT})()`, true) as Array<Omit<BrowserNodeRef, 'nodeRef'> & { selector: string }>
    const selectors = new Map<string, string>(); const nodes = rows.map((row, i) => { const nodeRef = `n${i + 1}`; selectors.set(nodeRef, row.selector); const { selector: _selector, ...node } = row; return { nodeRef, ...node } })
    r.snapshot = { snapshotId, selectors }; const tab = this.#state(r)
    return { kind: 'snapshot', snapshot: { snapshotId, url: tab.url, title: tab.title, text: nodes.map(n => `${n.nodeRef} ${n.role ?? 'element'} ${JSON.stringify(n.name ?? '')}`).join('\n'), nodes }, tab }
  }
  async #elementInfo(r: SurfaceRecord, value: BrowserLocator): Promise<BrowserNodeRef> { const p = this.#locatorPayload(r, value); return r.view.webContents.executeJavaScript(`(${ELEMENT_SCRIPT})(${JSON.stringify(p)})`, true) as Promise<BrowserNodeRef> }
  #locatorPayload(r: SurfaceRecord, value: BrowserLocator): Record<string, unknown> { if (value.kind !== 'node') return value; if (r.snapshot?.snapshotId !== value.snapshotId) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Snapshot ${value.snapshotId} is stale.`); const selector = r.snapshot.selectors.get(value.nodeRef); if (selector === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Node ${value.nodeRef} is absent.`); return { kind: 'node', selector, nodeRef: value.nodeRef } }
  async #wait(r: SurfaceRecord, command: Extract<BrowserCommand, { kind: 'wait' }>, serial: number): Promise<void> {
    const deadline = Date.now() + Math.min(command.timeoutMs ?? 15_000, 120_000)
    for (;;) {
      this.#assertNotInterrupted(r, serial); const tab = this.#state(r)
      if (command.condition === 'load' && !tab.loading) return
      if (command.condition === 'url' && tab.url.includes(command.value ?? '')) return
      if (command.condition === 'dialog') throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', 'IAB dialog waits require an explicit dialog policy.')
      if ((command.condition === 'visible' || command.condition === 'hidden') && command.locator !== undefined) { const p = this.#locatorPayload(r, command.locator); const visible = await r.view.webContents.executeJavaScript(`(${VISIBLE_SCRIPT})(${JSON.stringify(p)})`, true) as boolean; if (visible === (command.condition === 'visible')) return }
      if (Date.now() >= deadline) throw new BrowserRuntimeError('TIMEOUT', `Browser wait for ${command.condition} timed out.`)
      await new Promise(done => setTimeout(done, 100))
    }
  }
  async #waitLoad(r: SurfaceRecord, ms: number, serial: number): Promise<void> { const deadline = Date.now() + ms; while (r.view.webContents.isLoading()) { this.#assertNotInterrupted(r, serial); if (Date.now() >= deadline) throw new BrowserRuntimeError('TIMEOUT', 'Navigation timed out.'); await new Promise(done => setTimeout(done, 100)) } }
  #timeout<T>(ms: number, message: string): Promise<T> { return new Promise((_resolve, reject) => { const timer = setTimeout(() => reject(new BrowserRuntimeError('TIMEOUT', message)), ms); timer.unref?.() }) }
}

const FIND_SCRIPT = `(locator) => { if (!locator) return document.body; if (locator.kind === 'node') return document.querySelector(locator.selector); const all=[...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex],label')]; const name=el=>(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||el.placeholder||'').trim(); if(locator.kind==='role')return all.find(el=>(el.getAttribute('role')||el.tagName.toLowerCase())===locator.role&&(!locator.name||name(el).includes(locator.name))); if(locator.kind==='text')return all.find(el=>locator.exact?name(el)===locator.text:name(el).includes(locator.text)); if(locator.kind==='label'){const label=[...document.querySelectorAll('label')].find(el=>name(el).includes(locator.label));return label?.control||all.find(el=>el.getAttribute('aria-label')?.includes(locator.label));} }`
const ELEMENT_SCRIPT = `(locator)=>{const find=${FIND_SCRIPT};const el=find(locator);if(!el)throw new Error('element not found');const input=el;return{nodeRef:locator.nodeRef||'semantic',role:el.getAttribute('role')||el.tagName.toLowerCase(),name:(el.getAttribute('aria-label')||el.getAttribute('title')||el.innerText||input.placeholder||'').trim().slice(0,240),...(input.type?{inputType:input.type}:{}),...(input.autocomplete?{autocomplete:input.autocomplete}:{})}}`
const VISIBLE_SCRIPT = `(locator)=>{const find=${FIND_SCRIPT};const el=find(locator);if(!el)return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'}`
const ACTION_SCRIPT = `(payload)=>{const find=${FIND_SCRIPT};const el=find(payload.locator);if(!el)throw new Error('element not found');el.focus();if(payload.action==='click')el.click();else if(payload.action==='fill'){el.value=payload.value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));el.dispatchEvent(new Event('change',{bubbles:true}))}else if(payload.action==='type'){el.value=String(el.value||'')+payload.value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}))}else if(payload.action==='press'){const key=payload.value||'Enter';el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));if(key==='Enter'){if(el.tagName==='BUTTON'||el.tagName==='A')el.click();else if(el.form)el.form.requestSubmit()}el.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true}))}else if(payload.action==='select'){el.value=payload.value;el.dispatchEvent(new Event('change',{bubbles:true}))}else if(payload.action==='check'){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}else if(payload.action==='scroll')el.scrollBy(0,Number(payload.value)||600);else if(payload.action==='drag'){const destination=find(payload.destination);if(!destination)throw new Error('drag destination not found');const transfer=new DataTransfer();el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));destination.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:transfer}));destination.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));destination.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));el.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}))}return true}`
