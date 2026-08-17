import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

describe('AppFrame native title-bar drag region', () => {
  it('keeps a shallow macOS-only fallback above the column-owned header regions', () => {
    expect(css).toContain(".frame[data-native-window-chrome='macos']::before")
    expect(css).toContain('height: 8px;')
    expect(css).toContain('-webkit-app-region: drag;')
  })

  it('centers one stable reopen seat on both platform header baselines', () => {
    expect(css).toContain('--dsh-sidebar-toggle-left: 16px;')
    expect(css).toContain('--dsh-collapsed-title-leading: 32px;')
    expect(css).toContain(".frame[data-native-window-chrome='macos']")
    expect(css).toContain('--dsh-sidebar-toggle-left: 82px;')
    expect(css).toContain('--dsh-collapsed-title-leading: 98px;')
    expect(css).toMatch(/\.sidebarToggleSeat\s*\{[\s\S]*?top: 10px;[\s\S]*?width: 28px;[\s\S]*?height: 28px;/)
  })
})
