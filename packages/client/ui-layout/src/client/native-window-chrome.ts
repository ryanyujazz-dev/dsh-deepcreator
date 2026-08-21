/** Native window chrome variants that affect root-frame presentation. */
export type NativeWindowChrome = 'macos' | 'windows'

/**
 * Detect the macOS and Windows Electron renderers without affecting ordinary
 * desktop browsers. Electron does not expose its main-process platform
 * through the sandboxed page, but its default user agent contains both
 * stable product tokens.
 */
export function detectNativeWindowChrome(userAgent: string): NativeWindowChrome | undefined {
  if (!/\bElectron\/\d/u.test(userAgent)) return undefined
  if (/\bMacintosh\b/u.test(userAgent)) return 'macos'
  if (/\bWindows NT\b/u.test(userAgent)) return 'windows'
  return undefined
}
