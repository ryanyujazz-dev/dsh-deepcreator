// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { INTERACTIVE_SNAPSHOT_SCRIPT, type BrowserSnapshotScriptRow } from '../src/snapshot-script.ts'

afterEach(() => { document.body.innerHTML = '' })

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
