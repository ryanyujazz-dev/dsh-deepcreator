import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)), 'utf8')

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

describe('SettingsRoot.module.css', () => {
  it('keeps the rail trigger on the shared Settings row height', () => {
    const rail = declarations('.trigger.rail')
    expect(rail?.get('width')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(rail?.get('height')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(rail?.get('margin')).toBe('4px 0')
  })

  it('uses the shared interface body role for navigation', () => {
    expect(declarations('.navCell')?.get('font-size')).toBe('12px')
    expect(declarations('.navCell')?.get('line-height')).toBe('18px')
    expect(declarations('.navTitle')?.get('font-size')).toBe('14px')
    expect(declarations('.navTitle')?.get('line-height')).toBe('22px')
  })
})
