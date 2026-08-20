import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/** Extract one CSS rule as normalized property/value pairs. */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('aligns the expanded brand row to the 48px conversation header', () => {
    const root = declarations('.root')
    const logoRow = declarations('.logoRow')
    expect(root?.get('padding')).toBe('0 var(--dsh-sidebar-inline-padding) 6px')
    expect(root?.get('--dsh-sidebar-section-margin-top')).toBe('10px')
    expect(root?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(root?.get('line-height')).toBe('var(--dsw-font-sidebar-line-height, 18px)')
    expect(root?.get('font-weight')).toBe('var(--dsw-font-weight-regular, 400)')
    expect(logoRow?.get('height')).toBe('48px')
    expect(logoRow?.get('align-items')).toBe('center')
    expect(logoRow?.get('justify-content')).toBe('space-between')
    expect(logoRow?.get('padding')).toBe('0 0 0 7px')
    expect(logoRow?.get('margin')).toBe('0')
    expect(declarations("[data-native-window-chrome='macos']:not([data-window-maximized]):not([data-window-fullscreen]) .logoRow")?.get('padding-left')).toBe('77px')
  })

  it('uses blank macOS brand-row space for dragging without swallowing its controls', () => {
    expect(declarations("[data-native-window-chrome='macos']:not([data-window-maximized]):not([data-window-fullscreen]) .logoRow")?.get('-webkit-app-region'))
      .toBe('drag')
    expect(declarations('.brand')?.get('flex')).toBe('0 1 auto')
    expect(declarations("[data-native-window-chrome='macos'] .brand")?.get('-webkit-app-region'))
      .toBe('no-drag')
    expect(declarations("[data-native-window-chrome='macos'] .iconButton")?.get('-webkit-app-region'))
      .toBe('no-drag')
  })

  it('uses the shared 28px circle for the frame-seated reopen control', () => {
    expect(declarations('.iconButton')?.get('width')).toBe('var(--dsh-icon-toolbar-button-size, 28px)')
    expect(declarations('.iconButton')?.get('height')).toBe('var(--dsh-icon-toolbar-button-size, 28px)')
    expect(declarations('.closedToggle')?.get('color')).toBe('var(--dsw-alias-label-secondary)')
  })

  it('owns primary-row spacing at the marginless list container', () => {
    const list = declarations('.primaryList')
    expect(list?.get('gap')).toBe('2px')
    expect(list?.get('margin')).toBe('0')
    expect(list?.get('padding')).toBe('0')
    expect(declarations('.primaryListItem')?.get('margin')).toBe('0')
    expect(declarations('.newSession')?.get('margin')).toBe('0')
    expect(declarations('.skillsPlaceholder')?.get('margin')).toBe('0')
    expect(declarations('.scheduledTasksPlaceholder')?.get('margin')).toBe('0')
  })
})
