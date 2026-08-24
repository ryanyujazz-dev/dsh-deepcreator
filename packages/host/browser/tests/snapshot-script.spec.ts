// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { DOCUMENT_EXTRACTION_SCRIPT, INTERACTIVE_SNAPSHOT_SCRIPT, type BrowserDocumentScriptResult, type BrowserSnapshotScriptRow } from '../src/snapshot-script.ts'

afterEach(() => { document.body.innerHTML = ''; Reflect.deleteProperty(document, 'contentType') })

describe('provider-neutral interactive snapshot policy', () => {
  it('omits hidden controls and sensitive values while retaining ordinary editable values', () => {
    document.body.innerHTML = `
      <input type="hidden" name="csrf_token" value="hidden-secret">
      <input name="query" value="deepseek">
      <input name="access_token" value="visible-secret">
      <input type="password" value="password-secret">
      <button value="button-secret">Search</button>
      <button aria-hidden="true">Invisible</button>
    `
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ x: 0, y: 0, width: 100, height: 20, top: 0, right: 100, bottom: 20, left: 0, toJSON() {} }) })
    const collect = (0, eval)(`(${INTERACTIVE_SNAPSHOT_SCRIPT})`) as () => BrowserSnapshotScriptRow[]
    const rows = collect()

    expect(rows.some(row => row.name === 'Invisible')).toBe(false)
    expect(rows.some(row => row.value === 'hidden-secret')).toBe(false)
    expect(rows.find(row => row.selector.includes('input:nth-of-type(2)'))?.value).toBe('deepseek')
    expect(rows.some(row => row.value === 'visible-secret')).toBe(false)
    expect(rows.some(row => row.value === 'password-secret')).toBe(false)
    expect(rows.some(row => row.value === 'button-secret')).toBe(false)
  })
})

describe('provider-neutral document extraction policy', () => {
  it('extracts article structure, sanitizes links, excludes hidden and sensitive form values, and paginates', () => {
    document.title = 'Research'
    document.body.innerHTML = `<main><h1>Heading</h1><p>Visible paragraph <a href="https://example.test/path?token=secret#frag">source</a></p><p hidden>Hidden text</p><input type="password" value="secret"><ul><li>First item</li></ul><table><tr><th>Name</th><td>DeepCreator</td></tr></table><pre>const answer = 42</pre></main>`
    const collect = (0, eval)(`(${DOCUMENT_EXTRACTION_SCRIPT})`) as (input?: Record<string, unknown>) => BrowserDocumentScriptResult
    const first = collect({ maxChars: 24 })
    expect(first.text).toContain('# Research')
    expect(first.text).not.toContain('secret')
    expect(first.text).not.toContain('?token=')
    expect(first.truncated).toBe(true)
    const second = collect({ documentId: first.documentId, offset: first.nextOffset, maxChars: 20_000 })
    expect(second.offset).toBe(first.nextOffset)
    expect(second.error).toBeUndefined()
    expect(`${first.text}${second.text}`).toContain('First item')
    expect(`${first.text}${second.text}`).toContain('Name | DeepCreator')
    expect(`${first.text}${second.text}`).toContain('const answer = 42')
  })

  it.each(['text/plain', 'application/json', 'application/xml'])('reads raw %s bodies directly', contentType => {
    Object.defineProperty(document, 'contentType', { configurable: true, value: contentType })
    document.body.innerHTML = '<pre>{"project":"DeepCreator","value":42}</pre>'
    const collect = (0, eval)(`(${DOCUMENT_EXTRACTION_SCRIPT})`) as (input?: Record<string, unknown>) => BrowserDocumentScriptResult
    expect(collect()).toMatchObject({ contentType, text: expect.stringContaining('"project":"DeepCreator"'), truncated: false })
  })

  it('enforces the 20,000-character page ceiling for long documents', () => {
    document.body.innerHTML = `<article><p>${'x'.repeat(30_000)}</p></article>`
    const collect = (0, eval)(`(${DOCUMENT_EXTRACTION_SCRIPT})`) as (input?: Record<string, unknown>) => BrowserDocumentScriptResult
    const result = collect({ maxChars: 99_999 })
    expect(result.text).toHaveLength(20_000)
    expect(result.nextOffset).toBe(20_000)
    expect(result.truncated).toBe(true)
  })

  it('returns STALE_DOCUMENT when the page changes between reads', () => {
    document.body.innerHTML = '<article><p>Version one</p></article>'
    const collect = (0, eval)(`(${DOCUMENT_EXTRACTION_SCRIPT})`) as (input?: Record<string, unknown>) => BrowserDocumentScriptResult
    const first = collect({ maxChars: 5 })
    document.body.innerHTML = '<article><p>Version two</p></article>'
    expect(collect({ documentId: first.documentId, offset: first.nextOffset })).toMatchObject({ error: 'STALE_DOCUMENT' })
  })
})
