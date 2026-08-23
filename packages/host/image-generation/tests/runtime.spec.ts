import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ImageGenerationRuntime } from '../src/runtime.ts'
import type { CreateImageResult, ImageGenerationRequestContext } from '../src/types.ts'

const request: ImageGenerationRequestContext = {
  sessionId: 'session-1', turn: 2, workspaceRoot: '/workspace', provider: 'provider', model: 'model', prompt: 'blue house',
  aspectRatio: '1:1', resolution: '1K', inputs: [], outputPath: 'house.png',
}
const result = { path: 'house.png' } as CreateImageResult

describe('ImageGenerationRuntime', () => {
  it('wraps requests in registration order and disposes middleware', async () => {
    const runtime = new ImageGenerationRuntime(new Context())
    const order: string[] = []
    const dispose = runtime.registerRequestMiddleware(async (_request, next) => {
      order.push('before')
      const value = await next()
      order.push('after')
      return value
    })
    await expect(runtime.run(request, async () => { order.push('execute'); return result })).resolves.toBe(result)
    expect(order).toEqual(['before', 'execute', 'after'])
    dispose()
    order.length = 0
    await runtime.run(request, async () => { order.push('execute'); return result })
    expect(order).toEqual(['execute'])
  })

  it('publishes success and failure without allowing observer errors to change the call', async () => {
    const runtime = new ImageGenerationRuntime(new Context())
    const listener = vi.fn(() => { throw new Error('observer unavailable') })
    runtime.onResult(listener)
    await expect(runtime.run(request, async () => result)).resolves.toBe(result)
    await expect(runtime.run(request, async () => { throw new Error('provider failed') })).rejects.toThrow('provider failed')
    expect(listener.mock.calls.map(([event]) => event.status)).toEqual(['succeeded', 'failed'])
  })
})
