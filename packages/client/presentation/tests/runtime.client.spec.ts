import { describe, expect, it, vi } from 'vitest'
import * as hostEntry from '../src/index.ts'
import { PresentationClientRuntime, PresentationProviderRegistry } from '../src/client/runtime.ts'

function ok<T>(value: T) { return Promise.resolve({ ok: true as const, value: { ok: true as const, value } }) }

describe('PresentationClientRuntime', () => {
  it('exposes a valid no-op Host loader entry', () => {
    expect(hostEntry.apply).toBeTypeOf('function')
  })

  it('allows a replacement UI to win by provider priority without changing Host resources', () => {
    const registry = new PresentationProviderRegistry()
    const workbench = { id: 'workbench', priority: 10, resourceKinds: ['browser-tab'], modes: ['snapshot'] as const, surfaceHost: false, present: vi.fn() }
    const floating = { ...workbench, id: 'floating', priority: 20 }
    registry.register(workbench); registry.register(floating)
    expect(registry.resolve({ kind: 'browser-tab', id: 'tab', mode: 'snapshot' })).toBe(floating)
    expect(registry.resolve({ kind: 'artifact', id: 'a', mode: 'none' })).toBeUndefined()
  })

  it('advertises only registered capabilities and claims before presenting', async () => {
    const request = { requestId: 'r1', sessionId: 's1', turn: 1, createdAt: Date.now(), deadlineAt: Date.now() + 1_000, resource: { kind: 'artifact', id: 'a', mode: 'none' as const } }
    const calls: string[] = []
    const acknowledge = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { acknowledged: true } } }))
    const remote = {
      pending: vi.fn(async (_session, client) => { calls.push(`pending:${client.presenters.map((item: { resourceKind: string }) => item.resourceKind).join(',')}`); return ok({ revision: 1, requests: [request] }) }),
      claim: vi.fn(async () => { calls.push('claim'); return ok({ claimed: true, request }) }), acknowledge,
      dismiss: vi.fn(async () => ok({ dismissed: true as const })),
    }
    const runtime = new PresentationClientRuntime(remote, () => 's1' as never)
    runtime.providers.register({ id: 'artifact', priority: 1, resourceKinds: ['artifact'], modes: ['none'], surfaceHost: false, present: async () => { calls.push('present'); return { status: 'presented' } } })
    await runtime.poll()
    expect(calls).toEqual(['pending:artifact', 'claim', 'present'])
    expect(acknowledge).toHaveBeenCalledWith('s1', expect.objectContaining({ clientId: runtime.clientId, status: 'presented' }))
  })

  it('dismisses through the presenter that supports the original resource mode and session', async () => {
    const request = { requestId: 'r-live', sessionId: 's1', turn: 4, createdAt: Date.now(), deadlineAt: Date.now() + 1_000, resource: { kind: 'browser-tab', id: 'tab-1', mode: 'live' as const } }
    const dismissRemote = vi.fn(async () => ok({ dismissed: true as const }))
    const dismissPresenter = vi.fn()
    const remote = {
      pending: vi.fn(async () => ok({ revision: 1, requests: [request] })),
      claim: vi.fn(async () => ok({ claimed: true, request })),
      acknowledge: vi.fn(async () => ok({ acknowledged: true })), dismiss: dismissRemote,
    }
    const runtime = new PresentationClientRuntime(remote, () => 's1' as never)
    runtime.providers.register({ id: 'live', priority: 1, resourceKinds: ['browser-tab'], modes: ['live'], surfaceHost: true, present: async () => ({ status: 'presented' }), dismiss: dismissPresenter })
    await runtime.poll()
    runtime.dismiss('browser-tab', 'tab-1')
    expect(dismissPresenter).toHaveBeenCalledWith('browser-tab:tab-1')
    expect(dismissRemote).toHaveBeenCalledWith('s1', 4, 'browser-tab:tab-1')
  })

  it('opens explicit user presentation inputs through the same Host boundary', async () => {
    const open = vi.fn(async (_sessionId, inputJson: string) => ok({
      requestId: 'user-1', resource: { kind: 'browser-tab', id: 'tab-1' }, status: 'presented' as const,
    }))
    const remote = {
      pending: vi.fn(async () => ok({ revision: 0, requests: [] })),
      claim: vi.fn(), acknowledge: vi.fn(), dismiss: vi.fn(), open,
    }
    const runtime = new PresentationClientRuntime(remote, () => 's1' as never)
    await expect(runtime.open({ kind: 'url', url: 'http://127.0.0.1:4312/index.html' })).resolves.toMatchObject({ status: 'presented' })
    expect(open).toHaveBeenCalledWith('s1', JSON.stringify({ kind: 'url', url: 'http://127.0.0.1:4312/index.html' }))
  })
})
