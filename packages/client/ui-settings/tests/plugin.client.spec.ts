import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'

describe('DeepCreator settings extension', () => {
  it('keeps official settings services and provides only presentation navigation', async () => {
    const ctx = new Context()
    const scope = { owner: 'official' }
    const schema = { owner: 'official' }
    ctx.provide('settingsScope', scope)
    ctx.provide('settingsSchema', schema)

    const fiber = ctx.plugin({ apply: apply as never })
    await fiber.await()

    expect(inject).toEqual([])
    expect(ctx.get('settingsScope')).toBe(scope)
    expect(ctx.get('settingsSchema')).toBe(schema)
    const navigation = ctx.get('settingsNavigation')
    expect(navigation?.commands.getSnapshot()).toEqual({ sequence: 0, request: null })
    navigation?.open('skills')
    expect(navigation?.commands.getSnapshot()).toEqual({ sequence: 1, request: { kind: 'open', sectionId: 'skills' } })
    await fiber.dispose()
    expect(ctx.get('settingsNavigation')).toBeUndefined()
  })
})
