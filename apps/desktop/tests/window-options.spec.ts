import { describe, expect, it } from 'vitest'
import {
  MACOS_TRAFFIC_LIGHT_POSITION,
  WINDOWS_TITLE_BAR_OVERLAY_BOOT,
  nativeWindowChromeOptions,
} from '../src/window-options.ts'

describe('nativeWindowChromeOptions', () => {
  it('removes the macOS title bar while retaining aligned native traffic lights', () => {
    expect(nativeWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hidden',
      trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
    })
    expect(MACOS_TRAFFIC_LIGHT_POSITION).toEqual({ x: 20, y: 17 })
  })

  it('hides the Windows title bar behind a themable Window Controls Overlay', () => {
    expect(nativeWindowChromeOptions('win32')).toEqual({
      titleBarStyle: 'hidden',
      titleBarOverlay: WINDOWS_TITLE_BAR_OVERLAY_BOOT,
      autoHideMenuBar: true,
    })
    // The overlay strip matches the standard native caption bar height, and
    // the boot colors are the dark base palette (bg-base / label-primary).
    expect(WINDOWS_TITLE_BAR_OVERLAY_BOOT.height).toBe(32)
    expect(WINDOWS_TITLE_BAR_OVERLAY_BOOT.color).toBe('rgb(21, 21, 23)')
    expect(WINDOWS_TITLE_BAR_OVERLAY_BOOT.symbolColor).toBe('rgb(249, 250, 251)')
  })

  it('leaves other platform frames and controls unchanged', () => {
    expect(nativeWindowChromeOptions('linux')).toEqual({})
    expect(nativeWindowChromeOptions('freebsd')).toEqual({})
  })
})
