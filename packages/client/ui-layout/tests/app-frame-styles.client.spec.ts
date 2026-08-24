import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/AppFrame.module.css', import.meta.url)), 'utf8')

describe('AppFrame native title-bar drag region', () => {
  it('keeps each shell occupant in its declared track when the phone Sidebar becomes absolute', () => {
    expect(css).toMatch(/\.sidebarCol\s*\{[\s\S]*?grid-column: 1;/)
    expect(css).toMatch(/\.centerCol\s*\{[\s\S]*?grid-column: 2;/)
    expect(css).toMatch(/\.detailsCol\s*\{[\s\S]*?grid-column: 3;/)
  })

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

  it('drops the macOS offsets once the window is maximized or fullscreen', () => {
    expect(css).toContain(".frame[data-native-window-chrome='macos']:not([data-window-maximized]):not([data-window-fullscreen])")
  })

  it('moves a focused details panel in lockstep with the animated Sidebar track', () => {
    expect(css).toMatch(/\.frame\[data-details-focused\] \.detailsCol\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?inset: 0 0 0 var\(--dsh-stage-left\);[\s\S]*?transition: left var\(--ds-transition-duration-slow\) var\(--ds-ease-in-out\);/)
    expect(css).toMatch(/\.frame\[data-dragging\]\[data-details-focused\] \.detailsCol\s*\{[\s\S]*?transition: none;/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.frame\[data-details-focused\] \.detailsCol\s*\{[\s\S]*?transition: none;/)
  })

  it('releases the ordinary third-column placement for the phone details overlay', () => {
    expect(css).toMatch(/\.frame\[data-phone\]\[data-mobile-details-open\] \.detailsCol\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?inset: 0;/)
  })

  it('reveals a full-height left-edge line on the details strip hover or drag', () => {
    expect(css).toMatch(/\.handle\[data-side='details'\]\s*\{[\s\S]*?margin-left: 0;/)
    expect(css).toMatch(/\.handle\[data-side='details'\]::after\s*\{[\s\S]*?width: 1px;[\s\S]*?background: var\(--dsw-alias-border-l1\);[\s\S]*?opacity: 0;/)
    expect(css).toMatch(/\.handle\[data-side='details'\]::after\s*\{[\s\S]*?left: 0;/)
    expect(css).toContain(".handle[data-side='details']:hover::after")
    expect(css).toContain(".handle[data-side='details'][data-dragging]::after")
  })
})
