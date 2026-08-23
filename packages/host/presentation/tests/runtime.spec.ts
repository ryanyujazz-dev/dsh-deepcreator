import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PresentationHostService } from '../src/index.ts'
import { PresentationRuntime } from '../src/runtime.ts'
import type { PresentationClientDescriptor } from '../src/types.ts'

const liveClient = (clientId: string): PresentationClientDescriptor => ({ clientId, presenters: [{ resourceKind: 'demo', modes: ['live'], surfaceHost: true }] })
const context = () => ({ sessionId: 'agent', turn: 1, workspaceRoot: '/tmp', signal: new AbortController().signal })

function runtime(settle = vi.fn()) {
  const value = new PresentationRuntime()
  value.registerResolver({
    kind: 'demo', description: 'demo resource',
    inputSchema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'demo', required: true }, id: { type: 'string', required: true } } },
    parse: input => input as { kind: 'demo'; id: string },
    materialize: async (_ctx, input) => ({ kind: 'demo', id: input.id, mode: 'live' }), settle,
  })
  return value
}

describe('PresentationRuntime', () => {
  it('registers resolvers through the Cordis service proxy', async () => {
    const ctx = new Context()
    new PresentationHostService(ctx)
    const dispose = ctx.presentationRuntime.registerResolver({
      kind: 'proxy-demo', description: 'proxy demo',
      inputSchema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'proxy-demo', required: true } } },
      parse: input => input as { kind: 'proxy-demo' },
      materialize: async () => ({ kind: 'proxy-demo', id: 'one' }),
    })
    expect(dispose).toBeTypeOf('function')
    dispose()
  })

  it('lets an explicit client action use the same resolver and receipt protocol while the Agent is idle', async () => {
    const ctx = new Context()
    const service = new PresentationHostService(ctx)
    service.registerResolver({
      kind: 'user-demo', description: 'user demo',
      inputSchema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'user-demo', required: true }, id: { type: 'string', required: true } } },
      parse: input => input as { kind: 'user-demo'; id: string },
      materialize: async (_context, input) => ({ kind: 'demo', id: input.id, mode: 'live' }),
    })
    const agent = { id: 'agent-user-open', session: { header: { cwd: '/tmp' } } } as unknown as Agent
    const opened = service.open(agent, JSON.stringify({ kind: 'user-demo', id: 'from-row' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    const pending = service.pending(agent, liveClient('desktop'))
    if (!pending.ok) throw new Error(pending.message)
    const request = pending.value.requests[0]!
    expect(request.turn).toBeLessThan(0)
    expect(service.claim(agent, request.requestId, liveClient('desktop'))).toMatchObject({ ok: true, value: { claimed: true } })
    expect(service.acknowledge(agent, { requestId: request.requestId, resourceKey: 'demo:from-row', clientId: 'desktop', status: 'presented' })).toMatchObject({ ok: true, value: { acknowledged: true } })
    await expect(opened).resolves.toMatchObject({ ok: true, value: { status: 'presented', resource: { id: 'from-row' } } })
  })

  it('filters incapable clients and fences claim/acknowledge by client id', async () => {
    const value = runtime()
    const opened = value.open(context(), value.parse({ kind: 'demo', id: 'one' }), 1_000)
    await new Promise(resolve => setTimeout(resolve, 0))
    const incapable = { clientId: 'web', presenters: [{ resourceKind: 'demo', modes: ['live'] as const, surfaceHost: false }] }
    expect(value.pending('agent', incapable).requests).toHaveLength(0)
    const request = value.pending('agent', liveClient('desktop')).requests[0]!
    expect(value.claim('agent', request.requestId, liveClient('desktop')).claimed).toBe(true)
    expect(value.claim('agent', request.requestId, liveClient('other')).claimed).toBe(false)
    expect(value.acknowledge('agent', { requestId: request.requestId, resourceKey: 'demo:one', clientId: 'other', status: 'presented' })).toBe(false)
    expect(value.acknowledge('agent', { requestId: request.requestId, resourceKey: 'demo:one', clientId: 'desktop', status: 'presented', presenterId: 'test' })).toBe(true)
    await expect(opened).resolves.toMatchObject({ status: 'presented', presenterId: 'test' })
  })

  it('returns a structured no-capable-client result and settles materialization', async () => {
    const settle = vi.fn()
    const value = runtime(settle)
    const result = await value.open(context(), value.parse({ kind: 'demo', id: 'two' }), 10)
    expect(result).toMatchObject({ status: 'unavailable', failure: { code: 'NO_CAPABLE_CLIENT', stage: 'claim', retryable: true } })
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ result }), { kind: 'demo', id: 'two' }, expect.objectContaining({ id: 'two' }))
  })

  it('suppresses a stable presenter failure for the rest of the turn without rematerializing', async () => {
    const value = runtime()
    const parsed = value.parse({ kind: 'demo', id: 'stable-failure' })
    const first = value.open(context(), parsed, 1_000)
    await new Promise(resolve => setTimeout(resolve, 0))
    const request = value.pending('agent', liveClient('desktop')).requests[0]!
    expect(value.claim('agent', request.requestId, liveClient('desktop')).claimed).toBe(true)
    expect(value.acknowledge('agent', {
      requestId: request.requestId, resourceKey: 'demo:stable-failure', clientId: 'desktop', status: 'unavailable',
      failure: { code: 'SURFACE_MOUNT_REJECTED', stage: 'mount', retryable: false, message: 'native mount failed' },
    })).toBe(true)
    await expect(first).resolves.toMatchObject({ status: 'unavailable', failure: { code: 'SURFACE_MOUNT_REJECTED', retryable: false } })

    const second = await value.open(context(), parsed, 1_000)
    expect(second).toMatchObject({ status: 'unavailable', failure: { code: 'SURFACE_MOUNT_REJECTED', retryable: false } })
    expect(second.resource).toBeUndefined()
    expect(second.failure?.message).toContain('suppressed for the rest of the current Agent turn')
    expect(value.pending('agent', liveClient('desktop')).requests).toHaveLength(0)
  })
})
