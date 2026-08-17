/** Platform-specific copy for the Host's native directory opener. */
export type NativeFileManager = 'finder' | 'explorer' | 'generic'

/**
 * Resolve only the local browser platform used to name the native file manager.
 * Remote Host connections deliberately use `generic`, because their desktop may
 * not match the browser's operating system.
 */
export function nativeFileManagerFromUserAgent(userAgent: string): NativeFileManager {
  if (/\bWindows\b/iu.test(userAgent)) return 'explorer'
  if (/\bMacintosh\b|\bMac OS X\b/iu.test(userAgent)) return 'finder'
  return 'generic'
}
