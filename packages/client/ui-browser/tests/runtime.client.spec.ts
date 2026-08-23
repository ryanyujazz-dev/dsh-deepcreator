import { describe, expect, it, vi } from 'vitest'
import { BrowserClientRuntime } from '../src/client/runtime.ts'
import type { BrowserRemoteClient } from '../src/client/runtime.ts'

describe('BrowserClientRuntime', () => {
  it('serializes overlapping refreshes and discards a response for a session that is no longer current', async () => {
    let current = 'agent-1'
    let releaseFirst!: (value: unknown) => void
    const first = new Promise(resolve => { releaseFirst = resolve })
    const state = vi.fn(async (sessionId: string) => {
      if (state.mock.calls.length === 1) return first
      return { ok: true as const, value: { ok: true as const, value: {
        sessionId, revision: 1, browsers: [], tabs: [{
          tabId: 'tab-current', browserId: 'iab', url: '', title: '', loading: false, canGoBack: false, canGoForward: false,
          lifecycle: 'deliverable' as const, presentation: 'live' as const,
          presentationBinding: { owner: 'deepcreator' as const, mode: 'live' as const, requiredBeforeControl: true },
          controlState: 'ready' as const, presentationState: 'presented' as const, surfaceId: 'surface-current',
        }],
      } } }
    })
    const runtime = new BrowserClientRuntime({ state } as unknown as BrowserRemoteClient, () => current as never)

    const oldRefresh = runtime.refresh()
    current = 'agent-2'
    const currentRefresh = runtime.refresh()
    releaseFirst({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision: 99, browsers: [], tabs: [] } } })
    await Promise.all([oldRefresh, currentRefresh])

    expect(state).toHaveBeenNthCalledWith(1, 'agent-1')
    expect(state).toHaveBeenNthCalledWith(2, 'agent-2')
    expect(runtime.getSnapshot().state).toMatchObject({ sessionId: 'agent-2', tabs: [{ tabId: 'tab-current' }] })
    runtime.dispose()
  })

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
    expect(snapshotImage).toHaveBeenCalledWith('agent-1', 'tab-1')
    expect(second).not.toBe(first)
    expect(runtime.getSnapshot()).toBe(second)
    expect(state).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('publishes screenshot hydration independently of Host revision and recovers after a failed preview fetch', async () => {
    const tab = {
      tabId: 'tab-1', browserId: 'playwright-chromium', url: 'https://example.test', title: 'Example', loading: false, canGoBack: false, canGoForward: false,
      lifecycle: 'deliverable' as const, presentation: 'snapshot' as const, presentationBinding: { owner: 'deepcreator' as const, mode: 'snapshot' as const, requiredBeforeControl: false },
      controlState: 'ready' as const, presentationState: 'presented' as const, snapshotArtifactId: 'shot-1',
    }
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision: 1, browsers: [], tabs: [tab] } } }))
    const snapshotImage = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { ok: false as const, code: 'BROWSER_UNAVAILABLE' as const, message: 'preview transport failed' } })
      .mockResolvedValueOnce({ ok: true as const, value: { ok: true as const, value: { artifactId: 'shot-1', dataUrl: 'data:image/png;base64,cG5n' } } })
    const runtime = new BrowserClientRuntime({ state, snapshotImage } as unknown as BrowserRemoteClient, () => 'agent-1' as never)

    await runtime.refresh()
    expect(runtime.getSnapshot().state.revision).toBe(1)
    expect(runtime.getSnapshot().state.tabs[0]?.snapshotImageDataUrl).toBeUndefined()
    expect(runtime.getSnapshot().snapshotErrors['tab-1']).toContain('preview transport failed')

    await runtime.retrySnapshot('tab-1')
    expect(runtime.getSnapshot().state.revision).toBe(1)
    expect(runtime.getSnapshot().state.tabs[0]?.snapshotImageDataUrl).toBe('data:image/png;base64,cG5n')
    expect(runtime.getSnapshot().snapshotErrors['tab-1']).toBeUndefined()
    expect(snapshotImage).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })

  it('bounds automatic screenshot retries until the user explicitly retries', async () => {
    let revision = 1
    const tab = {
      tabId: 'tab-1', browserId: 'playwright-chromium', url: 'https://example.test', title: 'Example', loading: false, canGoBack: false, canGoForward: false,
      lifecycle: 'deliverable' as const, presentation: 'snapshot' as const, presentationBinding: { owner: 'deepcreator' as const, mode: 'snapshot' as const, requiredBeforeControl: false },
      controlState: 'ready' as const, presentationState: 'presented' as const, snapshotArtifactId: 'shot-1',
    }
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision, browsers: [], tabs: [tab] } } }))
    const snapshotImage = vi.fn(async () => ({ ok: true as const, value: { ok: false as const, code: 'BROWSER_UNAVAILABLE' as const, message: 'preview transport failed' } }))
    const runtime = new BrowserClientRuntime({ state, snapshotImage } as unknown as BrowserRemoteClient, () => 'agent-1' as never)

    await runtime.refresh()
    await new Promise(resolve => setTimeout(resolve, 300))
    await new Promise(resolve => setTimeout(resolve, 550))
    expect(snapshotImage).toHaveBeenCalledTimes(3)

    revision++
    await runtime.refresh()
    expect(snapshotImage).toHaveBeenCalledTimes(3)

    await runtime.retrySnapshot('tab-1')
    expect(snapshotImage).toHaveBeenCalledTimes(4)
    runtime.dispose()
  })

  it('closes the Host Browser tab when a Workbench instance is closed', async () => {
    let closed = false
    const tab = {
      tabId: 'tab-1', browserId: 'iab', url: 'https://example.test', title: 'Example', loading: false, canGoBack: false, canGoForward: false,
      lifecycle: 'deliverable' as const, presentation: 'live' as const, presentationBinding: { owner: 'deepcreator' as const, mode: 'live' as const, requiredBeforeControl: true },
      controlState: 'ready' as const, presentationState: 'presented' as const, surfaceId: 'surface-1',
    }
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision: closed ? 2 : 1, browsers: [], tabs: closed ? [] : [tab] } } }))
    const closeTab = vi.fn(async (_sessionId: string, tabId: string) => { closed = true; return { ok: true as const, value: { ok: true as const, value: { closed: true as const, tabId } } } })
    const runtime = new BrowserClientRuntime({ state, closeTab } as unknown as BrowserRemoteClient, () => 'agent-1' as never)
    await runtime.refresh()

    await runtime.closeTab('tab-1')

    expect(closeTab).toHaveBeenCalledWith('agent-1', 'tab-1')
    expect(runtime.getSnapshot().state.tabs).toEqual([])
    expect(runtime.getSnapshot().state.revision).toBe(2)
    runtime.dispose()
  })

  it('treats an already-missing tab as a completed close instead of a Runtime outage', async () => {
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision: 2, browsers: [], tabs: [] } } }))
    const closeTab = vi.fn(async () => ({ ok: true as const, value: { ok: false as const, code: 'TAB_NOT_FOUND' as const, message: 'already gone' } }))
    const runtime = new BrowserClientRuntime({ state, closeTab } as unknown as BrowserRemoteClient, () => 'agent-1' as never)

    await runtime.closeTab('tab-gone')

    expect(closeTab).toHaveBeenCalledWith('agent-1', 'tab-gone')
    expect(runtime.getSnapshot().error).toBeUndefined()
    expect(runtime.getSnapshot().state.tabs).toEqual([])
    runtime.dispose()
  })

  it('keeps a stale user action scoped to its caller instead of poisoning Home state', async () => {
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision: 2, browsers: [], tabs: [] } } }))
    const navigateTab = vi.fn(async () => ({ ok: true as const, value: { ok: false as const, code: 'TAB_NOT_FOUND' as const, message: 'already gone' } }))
    const runtime = new BrowserClientRuntime({ state, navigateTab } as unknown as BrowserRemoteClient, () => 'agent-1' as never)

    await expect(runtime.navigateTab('tab-gone', 'https://example.test/')).rejects.toThrow('TAB_NOT_FOUND: already gone')

    expect(runtime.getSnapshot().error).toBeUndefined()
    runtime.dispose()
  })

  it('creates and navigates a client-owned tab through agent-fenced Remotes', async () => {
    let tab: {
      tabId: string; browserId: string; url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean
      lifecycle: 'deliverable'; presentation: 'live'; presentationBinding: { owner: 'deepcreator'; mode: 'live'; requiredBeforeControl: true }
      controlState: 'presentation-required' | 'interrupted'; presentationState: 'not-requested'; surfaceId: string
    } | undefined
    let revision = 0
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: { sessionId: 'agent-1', revision, browsers: [], tabs: tab === undefined ? [] : [tab] } } }))
    const newTab = vi.fn(async (_sessionId: string) => {
      tab = { tabId: 'tab-user', browserId: 'iab', url: '', title: '', loading: false, canGoBack: false, canGoForward: false, lifecycle: 'deliverable', presentation: 'live', presentationBinding: { owner: 'deepcreator', mode: 'live', requiredBeforeControl: true }, controlState: 'presentation-required', presentationState: 'not-requested', surfaceId: 'surface-user' }
      revision++
      return { ok: true as const, value: { ok: true as const, value: { tab, nextAction: { kind: 'open-in-deepcreator' as const, tool: 'open_in_deepcreator' as const, input: { kind: 'browser-tab' as const, tabId: tab.tabId } } } } }
    })
    const navigateTab = vi.fn(async (_sessionId: string, _tabId: string, url: string) => {
      tab = { ...tab!, url, controlState: 'interrupted' }; revision++
      return { ok: true as const, value: { ok: true as const, value: { tab } } }
    })
    const runtime = new BrowserClientRuntime({ state, newTab, navigateTab } as unknown as BrowserRemoteClient, () => 'agent-1' as never)

    await expect(runtime.newTab()).resolves.toMatchObject({ tabId: 'tab-user', lifecycle: 'deliverable' })
    expect(newTab).toHaveBeenCalledWith('agent-1')
    expect(runtime.getSnapshot().state.tabs).toHaveLength(1)
    await runtime.navigateTab('tab-user', 'https://example.test/')
    expect(navigateTab).toHaveBeenCalledWith('agent-1', 'tab-user', 'https://example.test/')
    expect(runtime.getSnapshot().state.tabs[0]).toMatchObject({ url: 'https://example.test/', controlState: 'interrupted' })
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
