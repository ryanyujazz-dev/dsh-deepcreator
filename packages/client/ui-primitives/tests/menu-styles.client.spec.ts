import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/Menu.module.css', import.meta.url)), 'utf8')

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

describe('Menu.module.css typography', () => {
  it('uses the shared interface body role for items and labels', () => {
    expect(declarations('.item')?.get('font-size')).toBe('12px')
    expect(declarations('.item')?.get('line-height')).toBe('18px')
    expect(declarations('.label')?.get('font-size')).toBe('12px')
    expect(declarations('.label')?.get('line-height')).toBe('18px')
  })

  it('changes compact menu geometry without changing typography', () => {
    const compactItem = declarations('.compactList .item')
    const compactLabel = declarations('.compactList .label')
    expect(compactItem?.get('font-size')).toBeUndefined()
    expect(compactItem?.get('line-height')).toBeUndefined()
    expect(compactLabel?.get('font-size')).toBeUndefined()
    expect(compactLabel?.get('line-height')).toBeUndefined()
  })
})
