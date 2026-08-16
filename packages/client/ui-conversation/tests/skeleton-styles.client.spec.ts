import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/skeleton/ConversationRoot.module.css', import.meta.url)), 'utf8')
const inputCss = readFileSync(fileURLToPath(new URL('../src/client/skeleton/InputBar.module.css', import.meta.url)), 'utf8')
const heroCss = readFileSync(fileURLToPath(new URL('../src/client/skeleton/HeroShell.module.css', import.meta.url)), 'utf8')

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

/** Extract one input-bar CSS rule as normalized property/value pairs. */
function inputDeclarations(selector: string): Map<string, string> | undefined {
  const withoutComments = inputCss.replace(/\/\*[\s\S]*?\*\//g, ' ')
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

/** Extract one hero-shell CSS rule as normalized property/value pairs. */
function heroDeclarations(selector: string): Map<string, string> | undefined {
  const withoutComments = heroCss.replace(/\/\*[\s\S]*?\*\//g, ' ')
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

describe('ConversationRoot.module.css', () => {
  it('keeps the single header row at 48px without a divider', () => {
    const header = declarations('.header')
    expect(header?.get('height')).toBe('48px')
    expect(header?.get('padding')).toBe('8px 28px')
    expect(header?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(header?.has('border-bottom')).toBe(false)
    expect(css).not.toContain('.header::after')
  })

  it('keeps both view-segment labels on the header text-size role', () => {
    const segment = declarations('.viewSegment')
    expect(segment?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(segment?.get('line-height')).toBe('var(--dsw-font-sidebar-line-height, 18px)')
  })

  it('keeps composer input and placeholder metrics on the transcript role', () => {
    expect(inputDeclarations('.card')?.get('font')).toBe('var(--dsw-font-markdown-base)')
    expect(inputCss).toMatch(/\.input,\s*\.mirror,\s*\.backdrop\s*\{[\s\S]*?font-size: inherit;[\s\S]*?font-weight: inherit;[\s\S]*?line-height: inherit;/)
    expect(inputDeclarations('.input::placeholder')?.get('font-size')).toBeUndefined()
    expect(inputDeclarations('.input::placeholder')?.get('font-weight')).toBeUndefined()
  })

  it('keeps the hero workspace picker at the preset picker text size', () => {
    const workspace = heroDeclarations('.workspace')
    expect(workspace?.get('font-size')).toBe('13px')
    expect(workspace?.get('line-height')).toBe('20px')
    expect(workspace?.get('font-weight')).toBe('500')
  })

  it('keeps the send and add controls on the same 28px circle geometry', () => {
    expect(inputDeclarations('.add')?.get('width')).toBe('28px')
    expect(inputDeclarations('.add')?.get('height')).toBe('28px')
    expect(inputDeclarations('.primary')?.get('width')).toBe('28px')
    expect(inputDeclarations('.primary')?.get('height')).toBe('28px')
  })

  it('anchors the conditional transcript masks to the viewport and composer edge', () => {
    expect(declarations('.scrollMaskTop')?.get('top')).toBe('0')
    expect(declarations('.scrollMaskBottom')?.get('bottom')).toBe('var(--dsh-composer-height, 152px)')
    expect(declarations('.scrollMask::after')?.get('height')).toBe('24px')
    expect(declarations(".root[data-phase='active'] .composerSeat")?.get('background'))
      .toBe('var(--dsw-alias-bg-base)')
  })
})
