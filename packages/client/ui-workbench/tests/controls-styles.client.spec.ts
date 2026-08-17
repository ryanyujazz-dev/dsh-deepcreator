import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/WorkbenchControls.module.css', import.meta.url)), 'utf8')

describe('Workbench Header control states', () => {
  it('uses the shared Workspace-header icon toolbar rhythm', () => {
    expect(css).toContain('gap: var(--dsh-icon-toolbar-gap, 4px)')
    expect(css).toContain('width: var(--dsh-icon-toolbar-button-size, 28px)')
    expect(css).toContain('height: var(--dsh-icon-toolbar-button-size, 28px)')
    expect(css).toContain('color: var(--dsw-alias-label-secondary)')
    expect(css).toContain('width: var(--dsh-icon-toolbar-glyph-size, 14px)')
  })

  it('colors the open-state glyph with the send button blue and keeps hover in both states', () => {
    const activeRule = css.match(/\.button\[aria-pressed='true'\]\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(activeRule).toContain('color: var(--dsw-alias-button-info-fill)')
    // No background declaration on the pressed rule: it would out-rank the
    // earlier :hover rule (equal specificity, later source order) and blank
    // the hover wash while the panel is open.
    expect(activeRule).not.toContain('background')
    expect(css).toContain('.button:hover')
  })
})
