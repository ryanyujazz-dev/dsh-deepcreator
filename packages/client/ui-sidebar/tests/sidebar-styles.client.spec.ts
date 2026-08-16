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
    expect(root?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(root?.get('line-height')).toBe('var(--dsw-font-sidebar-line-height, 18px)')
    expect(root?.get('font-weight')).toBe('var(--dsw-font-weight-regular, 400)')
    expect(logoRow?.get('height')).toBe('48px')
    expect(logoRow?.get('align-items')).toBe('center')
    expect(logoRow?.get('justify-content')).toBe('space-between')
    expect(logoRow?.get('padding')).toBe('0 0 0 7px')
  })

  it('keeps the collapsed rail on the expanded control geometry and one center line', () => {
    expect(declarations('.root.collapsed')?.get('padding')).toBe('0 12px 6px')
    expect(declarations('.collapsed .logoRow')?.get('height')).toBe('48px')
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('center')
    expect(declarations('.collapsed .iconButton')?.get('width')).toBe('28px')
    expect(declarations('.collapsed .newSession')?.get('width')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(declarations('.collapsed .newSession')?.get('height')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(declarations('.collapsed .newSession')?.get('justify-content')).toBe('center')
  })
})
