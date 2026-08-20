import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { WINDOW_STATE_CHANNELS, WindowStateBridge, type WindowState } from '../src/window-state.ts'

const ipcMain = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn() }))
vi.mock('electron', () => ({ ipcMain }))

/** Minimal BrowserWindow stand-in recording event listeners by name. */
function fakeWindow(initial: Partial<WindowState> = {}) {
  const state: { maximized: boolean; fullscreen: boolean } = { maximized: false, fullscreen: false, ...initial }
  const handlers: Record<string, () => void> = {}
  const send = vi.fn()
  const window = {
    on: vi.fn((event: string, listener: () => void) => { handlers[event] = listener }),
    isMaximized: vi.fn(() => state.maximized),
    isFullScreen: vi.fn(() => state.fullscreen),
    isDestroyed: vi.fn(() => false),
    webContents: { send },
  }
  return { window: window as unknown as BrowserWindow, handlers, send, state }
}

function getHandler(): (event: { sender: unknown }) => WindowState {
  const call = ipcMain.handle.mock.calls.find(call => call[0] === WINDOW_STATE_CHANNELS.get)
  if (call === undefined) throw new Error('get handler not registered')
  return call[1] as (event: { sender: unknown }) => WindowState
}

beforeEach(() => {
  ipcMain.handle.mockClear()
  ipcMain.removeHandler.mockClear()
})

describe('WindowStateBridge', () => {
  it('reports the current zoom state to the renderer on request', () => {
    const { window } = fakeWindow({ maximized: true, fullscreen: true })
    const bridge = new WindowStateBridge(window)
    bridge.install()
    expect(getHandler()({ sender: window.webContents }))
      .toEqual({ maximized: true, fullscreen: true })
  })

  it('pushes maximize, unmaximize, and fullscreen transitions to the renderer', () => {
    const { window, handlers, send, state } = fakeWindow()
    const bridge = new WindowStateBridge(window)
    bridge.install()

    state.maximized = true
    handlers['maximize']!()
    expect(send).toHaveBeenLastCalledWith(WINDOW_STATE_CHANNELS.changed, { maximized: true, fullscreen: false })

    state.maximized = false
    handlers['unmaximize']!()
    expect(send).toHaveBeenLastCalledWith(WINDOW_STATE_CHANNELS.changed, { maximized: false, fullscreen: false })

    state.fullscreen = true
    handlers['enter-full-screen']!()
    expect(send).toHaveBeenLastCalledWith(WINDOW_STATE_CHANNELS.changed, { maximized: false, fullscreen: true })

    state.fullscreen = false
    handlers['leave-full-screen']!()
    expect(send).toHaveBeenLastCalledWith(WINDOW_STATE_CHANNELS.changed, { maximized: false, fullscreen: false })
  })

  it('denies the get channel to a foreign renderer', () => {
    const { window } = fakeWindow()
    const bridge = new WindowStateBridge(window)
    bridge.install()
    expect(() => getHandler()({ sender: {} })).toThrow('foreign renderer')
  })

  it('removes its ipc handler on dispose', () => {
    const { window } = fakeWindow()
    const bridge = new WindowStateBridge(window)
    bridge.install()
    bridge.dispose()
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(WINDOW_STATE_CHANNELS.get)
  })

  it('skips publishing once the window is destroyed', () => {
    const { window, handlers, send } = fakeWindow()
    window.isDestroyed = vi.fn(() => true)
    const bridge = new WindowStateBridge(window)
    bridge.install()
    handlers['maximize']!()
    expect(send).not.toHaveBeenCalled()
  })
})
