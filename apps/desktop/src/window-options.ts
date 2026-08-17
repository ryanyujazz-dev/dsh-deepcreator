import type { BrowserWindowConstructorOptions } from 'electron'

/** Native macOS controls aligned to the 48px DeepCreator brand row. */
export const MACOS_TRAFFIC_LIGHT_POSITION = { x: 20, y: 17 } as const

/**
 * Return the platform-owned BrowserWindow chrome configuration.
 *
 * macOS keeps the real traffic lights while extending the renderer beneath
 * the removed title bar. Other platforms retain Electron's default frame so
 * their native window controls and resize behavior are unchanged.
 */
export function nativeWindowChromeOptions(
  platform: NodeJS.Platform,
): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'trafficLightPosition'> {
  if (platform !== 'darwin') return {}
  return {
    titleBarStyle: 'hidden',
    trafficLightPosition: MACOS_TRAFFIC_LIGHT_POSITION,
  }
}
