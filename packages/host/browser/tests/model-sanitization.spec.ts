import { describe, expect, it } from 'vitest'
import { redactBrowserUrl, sanitizeBrowserModelValue } from '../src/model-sanitization.ts'

describe('Browser model-output sanitization', () => {
  it('preserves useful search terms while redacting credentials and opaque payloads', () => {
    const result = new URL(redactBrowserUrl('https://example.test/search?wd=deepseek&access_token=secret&backurl=https%3A%2F%2Fother.test%2F%3Frsv_t%3Dnested&ext=' + 'x'.repeat(120)))
    expect(result.searchParams.get('wd')).toBe('deepseek')
    expect(result.searchParams.get('access_token')).toBe('[REDACTED]')
    expect(result.searchParams.get('backurl')).toBe('[REDACTED]')
    expect(result.searchParams.get('ext')).toBe('[REDACTED]')
  })

  it('redacts every URL field recursively without mutating non-URL text', () => {
    const original = { tab: { url: 'https://example.test/?signature=s3cr3t&q=public#access_token=fragment-secret', title: 'signature=s3cr3t' } }
    const result = sanitizeBrowserModelValue(original) as typeof original
    expect(new URL(result.tab.url).searchParams.get('signature')).toBe('[REDACTED]')
    expect(new URL(result.tab.url).searchParams.get('q')).toBe('public')
    expect(new URL(result.tab.url).hash).not.toContain('fragment-secret')
    expect(result.tab.title).toBe('signature=s3cr3t')
    expect(original.tab.url).toContain('s3cr3t')
  })
})
