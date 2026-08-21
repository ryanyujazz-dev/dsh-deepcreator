import { describe, expect, it } from 'vitest'
import { detectNativeWindowChrome } from '../src/client/native-window-chrome.ts'

describe('detectNativeWindowChrome', () => {
  it('marks only a macOS Electron renderer on Mac user agents', () => {
    expect(detectNativeWindowChrome(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Electron/43.4.0 Safari/537.36',
    )).toBe('macos')
    expect(detectNativeWindowChrome(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    )).toBeUndefined()
  })

  it('marks the Windows Electron renderer carrying the title strip', () => {
    expect(detectNativeWindowChrome(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Electron/43.4.0 Safari/537.36',
    )).toBe('windows')
    // Ordinary Windows browsers stay unmarked.
    expect(detectNativeWindowChrome(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    )).toBeUndefined()
  })

  it('leaves other Electron platforms and Linux browsers unmarked', () => {
    expect(detectNativeWindowChrome(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Electron/43.4.0 Safari/537.36',
    )).toBeUndefined()
    expect(detectNativeWindowChrome(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
    )).toBeUndefined()
  })
})
