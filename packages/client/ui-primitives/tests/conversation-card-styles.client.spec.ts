import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), `packages/client/ui-primitives/src/${path}`), 'utf8')

const cards = {
  code: source('markdown/CodeBlock.module.css'),
  read: source('ReadBlock.module.css'),
  search: source('SearchBlock.module.css'),
  terminal: source('TerminalBlock.module.css'),
  web: source('WebBlock.module.css'),
  diff: source('DiffBlock.module.css'),
}

describe('conversation content card chrome', () => {
  it('uses the turn-change card frame across content card families', () => {
    for (const css of Object.values(cards)) {
      expect(css).toContain('border: 1px solid var(--dsw-alias-border-l1);')
      expect(css).toContain('border-radius:')
      expect(css).toContain('var(--dsw-specific-sidebar-fill)')
    }
    expect(cards.code).toContain('--dsl-code-block-border-radius: 12px;')
    expect(cards.read).toContain('--dsl-read-radius: 12px;')
    expect(cards.search).toContain('--dsl-search-radius: 12px;')
    expect(cards.terminal).toContain('--dsl-terminal-radius: 12px;')
    expect(cards.web).toContain('--dsl-web-radius: 12px;')
    expect(cards.diff).toMatch(/\.hunk\s*\{[^}]*border-radius: 12px;/s)
  })

  it('keeps header actions transparent until hover and one continuous panel surface', () => {
    for (const css of [cards.code, cards.read, cards.search, cards.terminal, cards.diff]) {
      expect(css).toMatch(/\.copyButton:hover\s*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\);/s)
    }
    for (const css of [cards.code, cards.read, cards.search]) {
      expect(css).toContain('height: 42px;')
      expect(css).toContain('min-height: 42px;')
    }
    expect(cards.terminal).toContain('min-height: 42px;')
    expect(cards.code).toMatch(/\.block :where\(pre\)\s*\{[^}]*background: var\(--dsw-specific-sidebar-fill\);/s)
    expect(cards.code).toMatch(/\.block :where\(pre\.shiki\)\s*\{[^}]*background: var\(--dsw-specific-sidebar-fill\) !important;/s)
    expect(cards.read).toMatch(/\.body\s*\{[^}]*background: var\(--dsw-specific-sidebar-fill\);/s)
    expect(cards.search).toMatch(/\.body\s*\{[^}]*background: var\(--dsw-specific-sidebar-fill\);/s)
    expect(cards.terminal).toMatch(/\.output\s*\{[^}]*background: var\(--dsw-specific-sidebar-fill\);/s)
    expect(cards.diff).toMatch(/\.hunk\s*\{[^}]*background: var\(--dsw-specific-sidebar-fill\);/s)
    expect(cards.diff).toMatch(/\.path\s*\{[^}]*min-height: 42px;[^}]*background: var\(--dsw-specific-sidebar-fill\);/s)
    for (const css of [cards.code, cards.read, cards.search, cards.terminal, cards.diff]) {
      expect(css).toContain('border-top: 1px solid var(--dsw-alias-border-l1);')
    }
    expect(cards.diff).toMatch(/\.path\s*\{[^}]*height: 42px;[^}]*min-height: 42px;/s)
  })

  it('uses one icon-button treatment for every card copy action', () => {
    for (const css of [cards.code, cards.read, cards.search, cards.terminal, cards.diff]) {
      expect(css).toMatch(/\.copyButton\s*\{[^}]*width: 28px;[^}]*height: 28px;[^}]*border-radius: 50%;[^}]*color: var\(--dsw-alias-label-secondary\);[^}]*\}/s)
      expect(css).toMatch(/\.copyButton:hover\s*\{[^}]*color: var\(--dsw-alias-label-primary\);[^}]*background: var\(--dsw-alias-interactive-bg-hover\);[^}]*\}/s)
    }
  })
})
