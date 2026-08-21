import type { BrowserWindowConstructorOptions } from 'electron'

/** Native macOS controls aligned to the 48px DeepCreator brand row. */
export const MACOS_TRAFFIC_LIGHT_POSITION = { x: 20, y: 17 } as const

/**
 * Windows title strip height, matching the standard native caption bar so the
 * hidden title bar is replaced by a compact row of the same footprint. The
 * Window Controls Overlay buttons center within this strip, above the app's
 * own 48px header rows.
 */
export const WINDOWS_TITLE_BAR_HEIGHT = 32

/**
 * Boot-time overlay colors until the first theme snapshot arrives: the dark
 * base palette (ui-theme design-platform tokens) matching the window's own
 * `backgroundColor` pre-paint phase.
 */
export const WINDOWS_TITLE_BAR_OVERLAY_BOOT = {
  color: 'rgb(21, 21, 23)',
  symbolColor: 'rgb(249, 250, 251)',
  height: WINDOWS_TITLE_BAR_HEIGHT,
} as const

/**
 * Return the platform-owned BrowserWindow chrome configuration.
 *
 * macOS keeps the real traffic lights while extending the renderer beneath
 * the removed title bar. Windows also hides the native title bar but keeps
 * the native caption buttons through the Window Controls Overlay; the
 * renderer owns the 32px title strip beneath them, and the theme presenter
 * recolors the overlay with every theme change. Other platforms retain
 * Electron's default frame unchanged.
 */
export function nativeWindowChromeOptions(
  platform: NodeJS.Platform,
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition' | 'autoHideMenuBar' | 'titleBarOverlay'> {
  if (platform === 'win32') {
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: { ...WINDOWS_TITLE_BAR_OVERLAY_BOOT },
      autoHideMenuBar: true,
    }
  }
  if (platform !== 'darwin') return {}
  return {
    titleBarStyle: 'hidden',
    trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
  }
}
