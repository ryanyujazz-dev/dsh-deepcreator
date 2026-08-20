import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

export const WINDOW_STATE_CHANNELS = {
  get: 'deepcreator:window:get', changed: 'deepcreator:window:changed',
} as const

/** Native zoom/fullscreen flags the renderer needs for title-bar geometry. */
export interface WindowState { maximized: boolean; fullscreen: boolean }

/**
 * Push native window zoom/fullscreen changes to the renderer. macOS hides
 * the traffic lights on a maximized or fullscreen window, so the client
 * drops its fixed safe-area avoidance while either flag is set; the initial
 * `get` invoke covers a window that starts already zoomed.
 */
export class WindowStateBridge {
  readonly #disposers: Array<() => void> = []
  constructor(private readonly window: BrowserWindow) {}

  install(): void {
    const publish = (): void => this.publish()
    this.window.on('maximize', publish)
    this.window.on('unmaximize', publish)
    this.window.on('enter-full-screen', publish)
    this.window.on('leave-full-screen', publish)
    ipcMain.handle(WINDOW_STATE_CHANNELS.get, (event: IpcMainInvokeEvent) => {
      this.#assertSender(event)
      return this.state()
    })
    this.#disposers.push(() => { ipcMain.removeHandler(WINDOW_STATE_CHANNELS.get) })
  }

  state(): WindowState {
    return { maximized: this.window.isMaximized(), fullscreen: this.window.isFullScreen() }
  }

  publish(): void {
    if (this.window.isDestroyed()) return
    this.window.webContents.send(WINDOW_STATE_CHANNELS.changed, this.state())
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose()
  }

  #assertSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== this.window.webContents) throw new Error('window state IPC denied for foreign renderer')
  }
}
