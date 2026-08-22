import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

describe('DeepCreator settings extension', () => {
  it('declares no Cordis service dependency or replacement', () => {
    const ctx = new Context()
    const scope = { owner: 'official' }
    const schema = { owner: 'official' }
    ctx.provide('settingsScope', scope)
    ctx.provide('settingsSchema', schema)

    apply(ctx as ClientContext)

    expect(inject).toEqual([])
    expect(ctx.get('settingsScope')).toBe(scope)
    expect(ctx.get('settingsSchema')).toBe(schema)
  })
})
