import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { TITLE_BAR_THEME_CHANNEL, TitleBarThemeBridge } from '../src/titlebar-theme.ts'

const ipcMain = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain }))

/** Minimal BrowserWindow stand-in recording setTitleBarOverlay calls. */
function fakeWindow() {
  const window = {
    isDestroyed: vi.fn(() => false),
    setTitleBarOverlay: vi.fn(),
    webContents: { send: vi.fn() },
  }
  return { window: window as unknown as BrowserWindow, setTitleBarOverlay: window.setTitleBarOverlay }
}

function invoke(event: { sender: unknown }, color: unknown, symbolColor: unknown): void {
  const call = ipcMain.handle.mock.calls.find(call => call[0] === TITLE_BAR_THEME_CHANNEL)
  if (call === undefined) throw new Error('title bar theme handler not registered')
  call[1](event, color, symbolColor)
}

beforeEach(() => {
  ipcMain.handle.mockClear()
  ipcMain.removeHandler.mockClear()
})

describe('TitleBarThemeBridge', () => {
  it('forwards validated computed colors to the Window Controls Overlay', () => {
    const { window, setTitleBarOverlay } = fakeWindow()
    const bridge = new TitleBarThemeBridge(window)
    bridge.install()
    invoke({ sender: window.webContents }, 'rgb(21, 21, 23)', 'rgb(249, 250, 251)')
    expect(setTitleBarOverlay).toHaveBeenCalledWith({
      color: 'rgb(21, 21, 23)',
      symbolColor: 'rgb(249, 250, 251)',
    })
  })

  it('accepts rgba() with fractional alpha from getComputedStyle', () => {
    const { window, setTitleBarOverlay } = fakeWindow()
    new TitleBarThemeBridge(window).install()
    invoke({ sender: window.webContents }, 'rgba(255, 255, 255, 0.5)', 'rgba(0, 0, 0, 1)')
    expect(setTitleBarOverlay).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed colors and foreign renderers', () => {
    const { window, setTitleBarOverlay } = fakeWindow()
    new TitleBarThemeBridge(window).install()
    expect(() => invoke({ sender: window.webContents }, 'url(javascript:1)', 'rgb(0, 0, 0)'))
      .toThrow(/malformed computed color/)
    expect(() => invoke({ sender: window.webContents }, 'rgb(0, 0, 0)', { toString: 'rgb(0, 0, 0)' }))
      .toThrow(/malformed computed color/)
    expect(() => invoke({ sender: {} }, 'rgb(0, 0, 0)', 'rgb(0, 0, 0)'))
      .toThrow(/foreign renderer/)
    expect(setTitleBarOverlay).not.toHaveBeenCalled()
  })

  it('skips the overlay update for a destroyed window and unregisters on dispose', () => {
    const { window, setTitleBarOverlay } = fakeWindow()
    const bridge = new TitleBarThemeBridge(window)
    bridge.install()
    ;(window as unknown as { isDestroyed: () => boolean }).isDestroyed = vi.fn(() => true)
    invoke({ sender: window.webContents }, 'rgb(21, 21, 23)', 'rgb(249, 250, 251)')
    expect(setTitleBarOverlay).not.toHaveBeenCalled()
    bridge.dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(TITLE_BAR_THEME_CHANNEL)
  })
})
