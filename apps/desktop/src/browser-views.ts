import { BrowserWindow, WebContentsView, ipcMain, session, type IpcMainInvokeEvent } from 'electron'
import { allowedBrowserPanelUrl, normalizeBrowserViewBounds, type BrowserViewBounds } from './browser-view-policy.ts'

export const BROWSER_VIEW_CHANNELS = {
  create: 'deepcreator:browser:create', navigate: 'deepcreator:browser:navigate', back: 'deepcreator:browser:back',
  forward: 'deepcreator:browser:forward', reload: 'deepcreator:browser:reload', bounds: 'deepcreator:browser:bounds',
  close: 'deepcreator:browser:close', state: 'deepcreator:browser:state', popup: 'deepcreator:browser:popup',
} as const

export interface BrowserViewState { id: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

function partitionName(id: string): string { return `deepcreator-browser-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}` }

export class BrowserViewManager {
  readonly #views = new Map<string, WebContentsView>()
  readonly #disposers: Array<() => void> = []
  constructor(private readonly window: BrowserWindow) {}

  install(): void {
    const invoke = <T extends unknown[]>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: T) => unknown) => {
      ipcMain.handle(channel, handler)
      this.#disposers.push(() => { ipcMain.removeHandler(channel) })
    }
    invoke<[string, string, BrowserViewBounds]>(BROWSER_VIEW_CHANNELS.create, (event, id, url, bounds) => { this.#assertSender(event); return this.create(id, url, bounds) })
    invoke<[string, string]>(BROWSER_VIEW_CHANNELS.navigate, (event, id, url) => { this.#assertSender(event); return this.navigate(id, url) })
    invoke<[string]>(BROWSER_VIEW_CHANNELS.back, (event, id) => { this.#assertSender(event); this.#view(id).webContents.goBack() })
    invoke<[string]>(BROWSER_VIEW_CHANNELS.forward, (event, id) => { this.#assertSender(event); this.#view(id).webContents.goForward() })
    invoke<[string]>(BROWSER_VIEW_CHANNELS.reload, (event, id) => { this.#assertSender(event); this.#view(id).webContents.reload() })
    invoke<[string, BrowserViewBounds]>(BROWSER_VIEW_CHANNELS.bounds, (event, id, bounds) => { this.#assertSender(event); this.#view(id).setBounds(normalizeBrowserViewBounds(bounds)) })
    invoke<[string]>(BROWSER_VIEW_CHANNELS.close, (event, id) => { this.#assertSender(event); this.close(id) })
  }

  async create(id: string, rawUrl: string, bounds: BrowserViewBounds): Promise<BrowserViewState> {
    const url = allowedBrowserPanelUrl(rawUrl)
    if (url === undefined) throw new Error('browser view accepts HTTP(S) URLs only')
    const existing = this.#views.get(id)
    if (existing !== undefined) {
      existing.setBounds(normalizeBrowserViewBounds(bounds))
      if (existing.webContents.getURL() !== url.href) await existing.webContents.loadURL(url.href)
      return this.state(id)
    }
    const partition = partitionName(id)
    const browserSession = session.fromPartition(partition, { cache: false })
    browserSession.on('will-download', event => { event.preventDefault() })
    const view = new WebContentsView({ webPreferences: { partition, sandbox: true, contextIsolation: true, webSecurity: true, nodeIntegration: false } })
    this.#views.set(id, view)
    this.window.contentView.addChildView(view)
    view.setBounds(normalizeBrowserViewBounds(bounds))
    const publish = () => { this.window.webContents.send(BROWSER_VIEW_CHANNELS.state, this.state(id)) }
    view.webContents.on('did-start-loading', publish)
    view.webContents.on('did-stop-loading', publish)
    view.webContents.on('page-title-updated', publish)
    view.webContents.on('did-navigate', publish)
    view.webContents.on('will-navigate', (event, target) => { if (allowedBrowserPanelUrl(target) === undefined) event.preventDefault() })
    view.webContents.setWindowOpenHandler(({ url: popup }) => {
      const allowed = allowedBrowserPanelUrl(popup)
      if (allowed !== undefined) this.window.webContents.send(BROWSER_VIEW_CHANNELS.popup, { sourceId: id, url: allowed.href })
      return { action: 'deny' }
    })
    await view.webContents.loadURL(url.href)
    return this.state(id)
  }

  async navigate(id: string, rawUrl: string): Promise<BrowserViewState> {
    const url = allowedBrowserPanelUrl(rawUrl)
    if (url === undefined) throw new Error('browser view accepts HTTP(S) URLs only')
    await this.#view(id).webContents.loadURL(url.href)
    return this.state(id)
  }

  state(id: string): BrowserViewState {
    const contents = this.#view(id).webContents
    return { id, url: contents.getURL(), title: contents.getTitle(), loading: contents.isLoading(), canGoBack: contents.canGoBack(), canGoForward: contents.canGoForward() }
  }

  close(id: string): void {
    const view = this.#views.get(id)
    if (view === undefined) return
    this.#views.delete(id)
    this.window.contentView.removeChildView(view)
    view.webContents.close()
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose()
    for (const id of [...this.#views.keys()]) this.close(id)
  }

  #view(id: string): WebContentsView {
    const view = this.#views.get(id)
    if (view === undefined) throw new Error(`unknown browser view: ${id}`)
    return view
  }
  #assertSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== this.window.webContents) throw new Error('browser view IPC denied for foreign renderer')
  }
}
