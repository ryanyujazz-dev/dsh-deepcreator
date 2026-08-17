/** Native window chrome variants that affect root-frame presentation. */
export type NativeWindowChrome = 'macos'

/**
 * Detect the macOS Electron renderer without affecting ordinary Mac browsers.
 * Electron does not expose its main-process platform through the sandboxed
 * page, but its default user agent contains both stable product tokens.
 */
export function detectNativeWindowChrome(userAgent: string): NativeWindowChrome | undefined {
  return /\bElectron\/\d/u.test(userAgent) && /\bMacintosh\b/u.test(userAgent)
    ? 'macos'
    : undefined
}
