import { describe, expect, it } from 'vitest'
import { nativeFileManagerFromUserAgent } from '../src/client/file-manager.ts'

describe('nativeFileManagerFromUserAgent', () => {
  it('names Finder for macOS Electron and Safari clients', () => {
    expect(nativeFileManagerFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Electron/38.0.0'))
      .toBe('finder')
  })

  it('names Explorer for Windows clients and stays generic elsewhere', () => {
    expect(nativeFileManagerFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('explorer')
    expect(nativeFileManagerFromUserAgent('Mozilla/5.0 (X11; Linux x86_64)')).toBe('generic')
  })
})
