import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'

export const TITLE_BAR_THEME_CHANNEL = 'deepcreator:window:titlebar-theme'

/**
 * Color strings accepted over the bridge. getComputedStyle() only ever emits
 * rgb()/rgba() (occasionally with spaces), so anything else is rejected
 * before it reaches Electron's native overlay painter.
 */
const CSS_COMPUTED_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/

/**
 * Recolor the Window Controls Overlay from the sandboxed renderer. The theme
 * presenter resolves the active palette's base background and primary label
 * tokens and pushes both after every theme change; the main process only
 * ever forwards validated colors to `win.setTitleBarOverlay()`.
 */
export class TitleBarThemeBridge {
  readonly #disposers: Array<() => void> = []
  constructor(private readonly window: BrowserWindow) {}

  install(): void {
    ipcMain.handle(TITLE_BAR_THEME_CHANNEL, (event: IpcMainInvokeEvent, color: unknown, symbolColor: unknown) => {
      this.#assertSender(event)
      if (typeof color !== 'string' || typeof symbolColor !== 'string'
        || !CSS_COMPUTED_COLOR.test(color) || !CSS_COMPUTED_COLOR.test(symbolColor)) {
        throw new Error('title bar theme IPC denied: malformed computed color')
      }
      if (this.window.isDestroyed()) return
      this.window.setTitleBarOverlay({ color, symbolColor })
    })
    this.#disposers.push(() => { ipcMain.removeHandler(TITLE_BAR_THEME_CHANNEL) })
  }

  dispose(): void {
    for (const dispose of this.#disposers.splice(0)) dispose()
  }

  #assertSender(event: IpcMainInvokeEvent): void {
    if (event.sender !== this.window.webContents) throw new Error('title bar theme IPC denied for foreign renderer')
  }
}
