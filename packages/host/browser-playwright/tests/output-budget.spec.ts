import { describe, expect, it } from 'vitest'
import { budgetPlaywrightOutput } from '../src/tool.ts'

describe('playwright_run output budget', () => {
  it('caps strings, arrays, nesting, and final JSON with explicit warnings', () => {
    let deep: unknown = 'too deep'
    for (let index = 0; index < 12; index++) deep = { next: deep }
    const value = budgetPlaywrightOutput({
      text: 'x'.repeat(25_000),
      rows: Array.from({ length: 150 }, (_, index) => index),
      deep,
    }) as Record<string, unknown>
    expect((value.text as string).length).toBeGreaterThan(20_000)
    expect((value.rows as unknown[])).toHaveLength(100)
    expect(JSON.stringify(value)).toContain('depth > 10')
    expect(JSON.stringify(value)).toContain('truncated')
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(64 * 1024)
  })

  it('falls back to a bounded preview when many object fields exceed 64 KiB', () => {
    const value = budgetPlaywrightOutput(Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field${index}`, `\\\"${index}`.repeat(20_000)]))) as Record<string, unknown>
    expect(value.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(64 * 1024)
  })
})
