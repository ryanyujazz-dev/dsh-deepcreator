import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/markdown/MarkdownText.module.css', import.meta.url)),
  'utf8',
)

describe('MarkdownText typography', () => {
  it('keeps tables on the selected prose role and inline code on its two-pixel-smaller role', () => {
    expect(css).toMatch(/\.tableScroll th \{[\s\S]*?font: var\(--dsw-font-markdown-base-strong\);/)
    expect(css).toMatch(/\.tableScroll td \{[\s\S]*?font: var\(--dsw-font-markdown-base\);/)
    expect(css).toMatch(/\.markdown :not\(pre\) > code \{[\s\S]*?font: var\(--dsw-font-markdown-code\);/)
    expect(css).not.toMatch(/\.tableScroll table code/)
    expect(css).not.toContain('font-size: 0.875em')
  })
})
