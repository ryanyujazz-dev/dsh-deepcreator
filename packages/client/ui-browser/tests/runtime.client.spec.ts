import { describe, expect, it, vi } from 'vitest'
import { BrowserClientRuntime } from '../src/client/runtime.ts'
import type { BrowserRemoteClient } from '../src/client/runtime.ts'

describe('BrowserClientRuntime', () => {
  it('refetches full atomic state instead of applying client-side deltas', async () => {
    let revision = 1
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision, browsers: [], tabs: revision === 1 ? [] : [{
      tabId: 'tab-1', browserId: 'playwright-chromium', url: 'https://example.test', title: 'Example', loading: false, canGoBack: false, canGoForward: false,
      lifecycle: 'deliverable' as const, presentation: 'snapshot' as const, presentationBinding: { owner: 'deepcreator' as const, mode: 'snapshot' as const, requiredBeforeControl: false },
      controlState: 'ready' as const, presentationState: 'presented' as const, snapshotArtifactId: 'shot-1',
    }] } } }))
    const snapshotImage = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { artifactId: 'shot-1', dataUrl: 'data:image/png;base64,cG5n' } } }))
    const remote = { state, snapshotImage } as unknown as BrowserRemoteClient
    const runtime = new BrowserClientRuntime(remote, () => 'agent-1' as never)
    const initial = runtime.getSnapshot()
    expect(runtime.getSnapshot()).toBe(initial)
    await runtime.refresh()
    const first = runtime.getSnapshot()
    expect(first.state.revision).toBe(1)
    expect(runtime.getSnapshot()).toBe(first)
    revision = 2
    await runtime.refresh()
    const second = runtime.getSnapshot()
    expect(second.state.revision).toBe(2)
    expect(second.state.tabs[0]?.snapshotImageDataUrl).toBe('data:image/png;base64,cG5n')
    expect(snapshotImage).toHaveBeenCalledWith('tab-1')
    expect(second).not.toBe(first)
    expect(runtime.getSnapshot()).toBe(second)
    expect(state).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('distinguishes panel render, native mount, rejection, and success', async () => {
    const remote = { state: vi.fn() } as unknown as BrowserRemoteClient
    const runtime = new BrowserClientRuntime(remote, () => 'agent-1' as never)

    await expect(runtime.waitForSurface('never-rendered', 2)).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'PANEL_RENDER_TIMEOUT' }),
    })

    runtime.surfaceMountStarted('mounting')
    await expect(runtime.waitForSurface('mounting', 2)).resolves.toEqual({
      ok: false,
      failure: expect.objectContaining({ code: 'SURFACE_MOUNT_TIMEOUT' }),
    })

    runtime.surfaceMountStarted('rejected')
    const rejected = runtime.waitForSurface('rejected', 100)
    runtime.surfaceMountFailed('rejected', 'native view rejected the mount')
    await expect(rejected).resolves.toEqual({
      ok: false,
      failure: { code: 'SURFACE_MOUNT_REJECTED', message: 'native view rejected the mount' },
    })

    runtime.surfaceMountStarted('mounted')
    const mounted = runtime.waitForSurface('mounted', 100)
    runtime.surfaceMounted('mounted')
    await expect(mounted).resolves.toEqual({ ok: true })
    await expect(runtime.waitForSurface('mounted', 2)).resolves.toEqual({ ok: true })
    runtime.dispose()
  })
})
