import { describe, expect, it } from 'vitest'
import { matchBrowserUrl } from '../src/url-match.ts'

describe('Browser URL matching contract', () => {
  it('uses glob automatically when the value contains a wildcard', () => {
    expect(matchBrowserUrl('https://learn.chatgpt.com/docs/changelog', '**/docs/changelog')).toBe(true)
    expect(matchBrowserUrl('https://learn.chatgpt.com/docs', '**/docs/changelog')).toBe(false)
  })

  it('keeps legacy contains behavior for values without wildcards and supports explicit modes', () => {
    expect(matchBrowserUrl('https://example.test/docs/changelog?from=home', '/docs/changelog')).toBe(true)
    expect(matchBrowserUrl('https://example.test/docs', 'https://example.test/docs', 'exact')).toBe(true)
    expect(matchBrowserUrl('https://example.test/docs/more', 'https://example.test/docs', 'exact')).toBe(false)
    expect(matchBrowserUrl('https://example.test/a/b', 'https://example.test/*/b', 'glob')).toBe(true)
  })
})
