/** Browser artifact stays a single Host-served factory. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('ui-primitives client artifact', () => {
  it('does not require relative code-split chunks', () => {
    const artifact = readFileSync(resolve('packages/client/ui-primitives/lib/client.js'), 'utf8')
    expect(artifact).toMatch(/window\.__ModuleLoader__\.load\(\{\s*id:\s*["']@ryanyujazz\/dsh-client-ui-primitives["']/)
    expect(artifact).not.toMatch(/require\(["']\.\/[^"']+\.cjs["']\)/)
  })
})
