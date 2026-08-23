import { describe, expect, it, vi } from 'vitest'
import { BrowserRuntime, BrowserRuntimeError } from '../src/index.ts'
import type { BrowserCommand, BrowserCommandResult, BrowserDescriptor, BrowserProvider, BrowserProviderContext, BrowserTabRequest, ProviderTab } from '../src/types.ts'

class FakeProvider implements BrowserProvider {
  readonly close = vi.fn(async () => undefined)
  readonly release = vi.fn(async () => undefined)
  readonly clearData = vi.fn(async () => undefined)
  readonly execute = vi.fn(async (_context: BrowserProviderContext, tab: ProviderTab, command: BrowserCommand): Promise<BrowserCommandResult> => {
    if (command.kind === 'inspect' && command.action === 'snapshot') {
      return { kind: 'snapshot', snapshot: { snapshotId: 'snapshot-1', url: tab.url, title: tab.title, text: 'n1 button "Continue"', nodes: [{ nodeRef: 'n1', role: 'button', name: 'Continue' }] }, tab }
    }
    return { kind: 'state', tab }
  })
  constructor(readonly info: BrowserDescriptor) {}
  descriptor(): BrowserDescriptor { return this.info }
  async createTab(_context: BrowserProviderContext, request: BrowserTabRequest): Promise<ProviderTab> {
    return { providerTabId: `${this.info.browserId}-1`, ...(this.info.presentation.mode === 'live' ? { surfaceId: 'surface-1' } : {}), url: request.url ?? 'about:blank', title: 'Fake', loading: false, canGoBack: false, canGoForward: false }
  }
  async listAgentTabs(): Promise<ProviderTab[]> { return [] }
}

const signal = new AbortController().signal
const background = () => new FakeProvider({ browserId: 'background', providerKind: 'managed', family: 'chromium', profile: 'managed-persistent', name: 'Background', capabilities: ['core.tabs', 'core.navigation', 'core.snapshot', 'core.semantic-actions', 'automation.playwright', 'presentation.snapshot'], presentation: { owner: 'deepcreator', mode: 'snapshot', requiredBeforeControl: false }, availability: 'available' })
const visible = () => new FakeProvider({ browserId: 'visible', providerKind: 'in-app', family: 'chromium', profile: 'managed-persistent', name: 'Visible', capabilities: ['core.tabs', 'core.navigation', 'core.snapshot', 'core.semantic-actions', 'presentation.live', 'presentation.deepcreator-surface'], presentation: { owner: 'deepcreator', mode: 'live', requiredBeforeControl: true }, availability: 'available' })
const chrome = () => new FakeProvider({ browserId: 'chrome', providerKind: 'extension', family: 'chrome', profile: 'user', name: 'Chrome', capabilities: ['core.tabs', 'core.navigation', 'core.snapshot', 'core.semantic-actions', 'presentation.live', 'profile.user', 'profile.user-tabs', 'interaction.manual-handoff', 'interaction.secret-input-shielded'], presentation: { owner: 'provider', mode: 'live', requiredBeforeControl: false }, availability: 'available' })

describe('BrowserRuntime', () => {
  it('resolves automation, visibility, handoff, and user-profile requirements independently', () => {
    const runtime = new BrowserRuntime({ visibleProviderOrder: ['visible', 'chrome', 'background'] })
    runtime.registerProvider(background()); runtime.registerProvider(visible()); runtime.registerProvider(chrome())
    expect(runtime.resolve({ requirements: { automation: 'playwright', visibility: 'background' } }).browser.browserId).toBe('background')
    expect(runtime.resolve({ requirements: { visibility: 'live' } }).browser.browserId).toBe('visible')
    expect(runtime.resolve({ requirements: { visibility: 'live', interaction: 'manual-handoff', capabilities: ['interaction.secret-input-shielded'] } }).browser.browserId).toBe('chrome')
    expect(runtime.resolve({ requirements: { profile: 'user', capabilities: ['profile.user-tabs'] } }).browser.browserId).toBe('chrome')
    expect(() => runtime.resolve({ preference: { browserId: 'visible' }, requirements: { automation: 'playwright' } })).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' }))
  })

  it('never silently falls back from an explicit provider', () => {
    const runtime = new BrowserRuntime(); runtime.registerProvider(background())
    expect(() => runtime.select({ browserId: 'missing' })).toThrowError(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }))
    expect(() => runtime.select({ browserId: 'background', mode: 'visible' })).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' }))
  })

  it('requires an IAB presentation receipt before allowing automation', async () => {
    const runtime = new BrowserRuntime(); runtime.registerProvider(visible())
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 3, workspaceRoot: process.cwd(), selection: { browserId: 'visible' }, signal })
    expect(created.tab).toMatchObject({ controlState: 'presentation-required', presentationState: 'not-requested' })
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'snapshot' }, signal)).rejects.toMatchObject({ code: 'PRESENTATION_UNAVAILABLE' })
    runtime.markPresentationPending('agent-1', created.tab.tabId)
    runtime.settlePresentation('agent-1', created.tab.tabId, 'presented')
    expect(runtime.tab('agent-1', created.tab.tabId).lifecycle).toBe('deliverable')
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'snapshot' }, signal)).resolves.toMatchObject({ kind: 'snapshot' })
  })

  it('keeps a successfully presented live page open after the Agent turn ends', async () => {
    const provider = visible(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 8, workspaceRoot: process.cwd(), selection: { browserId: 'visible' }, signal })
    runtime.markPresentationPending('agent-1', created.tab.tabId)
    runtime.settlePresentation('agent-1', created.tab.tabId, 'presented')

    await runtime.endTurn('agent-1', 8)

    expect(provider.close).not.toHaveBeenCalled()
    expect(runtime.tab('agent-1', created.tab.tabId)).toMatchObject({ lifecycle: 'deliverable', presentationState: 'presented', controlState: 'ready' })
  })

  it('destroys the Provider page and logical identity when the user closes a tab', async () => {
    const provider = visible(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 8, workspaceRoot: process.cwd(), selection: { browserId: 'visible' }, signal })
    runtime.markPresentationPending('agent-1', created.tab.tabId)
    runtime.settlePresentation('agent-1', created.tab.tabId, 'presented')

    await runtime.close('agent-1', created.tab.tabId, signal)

    expect(provider.close).toHaveBeenCalledOnce()
    expect(() => runtime.tab('agent-1', created.tab.tabId)).toThrowError(expect.objectContaining({ code: 'TAB_NOT_FOUND' }))
    expect(runtime.state('agent-1').tabs).toEqual([])
  })

  it('fences node refs by snapshot and interrupts control by exact surface', async () => {
    const provider = visible(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'visible' }, signal })
    runtime.markPresentationPending('agent-1', created.tab.tabId)
    runtime.settlePresentation('agent-1', created.tab.tabId, 'presented')
    await runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'snapshot' }, signal)
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'act', action: 'click', locator: { kind: 'node', snapshotId: 'older', nodeRef: 'n1' } }, signal)).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' })
    runtime.interruptBySurface('surface-1')
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'title' }, signal)).rejects.toMatchObject({ code: 'CONTROL_INTERRUPTED' })
    runtime.reacquire('agent-1', created.tab.tabId)
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'title' }, signal)).resolves.toMatchObject({ kind: 'state' })
  })

  it('closes temporary tabs, releases claimed tabs, and preserves one-turn handoff', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const temporary = await runtime.createTab({ sessionId: 'agent-1', turn: 4, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    const handoff = await runtime.createTab({ sessionId: 'agent-1', turn: 4, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    runtime.markLifecycle('agent-1', handoff.tab.tabId, 'handoff')
    await runtime.endTurn('agent-1', 4)
    expect(provider.close).toHaveBeenCalledTimes(1)
    expect(() => runtime.tab('agent-1', temporary.tab.tabId)).toThrowError(BrowserRuntimeError)
    expect(runtime.tab('agent-1', handoff.tab.tabId).lifecycle).toBe('temporary')
  })

  it('serializes concurrent commands for the same logical tab', async () => {
    const provider = background(); let active = 0; let peak = 0
    provider.execute.mockImplementation(async (_context, tab) => {
      active++; peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active--
      return { kind: 'state', tab }
    })
    const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    await Promise.all([
      runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'title' }, signal),
      runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'url' }, signal),
    ])
    expect(peak).toBe(1)
  })

  it('closes managed tabs before clearing an isolated Provider profile', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    await runtime.clearProviderData('background')
    expect(provider.close).toHaveBeenCalledTimes(1)
    expect(provider.clearData).toHaveBeenCalledTimes(1)
    expect(() => runtime.tab('agent-1', created.tab.tabId)).toThrowError(expect.objectContaining({ code: 'TAB_NOT_FOUND' }))
  })
})
