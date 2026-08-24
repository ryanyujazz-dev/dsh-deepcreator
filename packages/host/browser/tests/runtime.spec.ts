import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    if (command.kind === 'inspect' && command.action === 'screenshot') return { kind: 'screenshot', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', tab }
    if (command.kind === 'navigate' && command.action === 'goto') return { kind: 'state', tab: { ...tab, url: command.url! } }
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

    await expect(runtime.close('agent-2', created.tab.tabId, signal)).rejects.toMatchObject({ code: 'TAB_NOT_OWNED' })
    await runtime.close('agent-1', created.tab.tabId, signal)
    await expect(runtime.close('agent-1', created.tab.tabId, signal)).resolves.toBeUndefined()

    expect(provider.close).toHaveBeenCalledOnce()
    expect(() => runtime.tab('agent-1', created.tab.tabId)).toThrowError(expect.objectContaining({ code: 'TAB_NOT_FOUND', details: expect.objectContaining({ lifecycleReason: 'client-close' }) }))
    expect(runtime.state('agent-1').tabs).toEqual([])
  })

  it('publishes screenshots once through the official Attachment Store and reuses the reference', async () => {
    const attachment = { attachmentId: 'attachment-1', mediaType: 'image/png', bytes: 8, width: 4, height: 2 } as const
    const saveImage = vi.fn(async () => attachment)
    const readImage = vi.fn(async () => ({ ref: attachment, data: Buffer.from('png-data') }))
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-browser-runtime-output-'))
    try {
      const provider = background(); const runtime = new BrowserRuntime({ attachments: { saveImage, readImage } as never }); runtime.registerProvider(provider)
      const created = await runtime.createTab({ sessionId: 'agent-1', turn: 1, workspaceRoot: workspace, selection: { browserId: 'background' }, signal })
      await runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'screenshot' }, signal)
      expect(saveImage).toHaveBeenCalledOnce()
      expect(runtime.tab('agent-1', created.tab.tabId)).toMatchObject({ snapshotAttachment: attachment })
      expect(runtime.tab('agent-1', created.tab.tabId)).not.toHaveProperty('snapshotArtifactId')
      await expect(runtime.screenshotImage('agent-1', created.tab.tabId)).resolves.toEqual({ attachment, dataUrl: 'data:image/png;base64,cG5nLWRhdGE=' })
      await expect(runtime.exportScreenshot('agent-1', created.tab.tabId, 'output/browser/screenshots/final.png'))
        .resolves.toBe(join('output', 'browser', 'screenshots', 'final.png'))
      await expect(readFile(join(workspace, 'output/browser/screenshots/final.png'))).resolves.toEqual(Buffer.from('png-data'))
      expect(readImage).toHaveBeenCalledWith(attachment)
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('invalidates Provider-owned tabs with an owner-restarted tombstone', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 1, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    runtime.invalidateProvider('background', 'owner-restarted')
    expect(() => runtime.tab('agent-1', created.tab.tabId)).toThrowError(expect.objectContaining({ code: 'TAB_NOT_FOUND', details: expect.objectContaining({ lifecycleReason: 'owner-restarted' }) }))
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

  it('executes a node-ref action sequence as one snapshot-fenced transaction and records diagnostics', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    await runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'snapshot' }, signal)

    await expect(runtime.execute('agent-1', created.tab.tabId, {
      kind: 'act', steps: [
        { action: 'fill', locator: { kind: 'node', snapshotId: 'snapshot-1', nodeRef: 'n1' }, value: 'codex cli' },
        { action: 'press', locator: { kind: 'node', snapshotId: 'snapshot-1', nodeRef: 'n1' }, value: 'Enter' },
      ], expected: 'navigation', expectedUrl: '**/results', urlMatch: 'glob',
    }, signal)).resolves.toMatchObject({ kind: 'action', outcome: { actionApplied: true, completedSteps: 2, postcondition: { kind: 'navigation', status: 'satisfied' } } })

    expect(provider.execute).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ kind: 'act', steps: expect.arrayContaining([expect.objectContaining({ action: 'fill' }), expect.objectContaining({ action: 'press' })]) }))
    expect(runtime.tab('agent-1', created.tab.tabId).snapshotId).toBeUndefined()
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'events' }, signal)).resolves.toMatchObject({
      kind: 'events', events: expect.arrayContaining([expect.objectContaining({ kind: 'snapshot-created' }), expect.objectContaining({ kind: 'snapshot-invalidated' }), expect.objectContaining({ kind: 'command-complete', command: 'act:fill>press' })]),
    })
  })

  it('rejects a lone fill navigation transaction before the Provider can mutate the page', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })

    await expect(runtime.execute('agent-1', created.tab.tabId, {
      kind: 'act', action: 'fill', locator: { kind: 'role', role: 'textbox', name: 'Search', exact: true }, value: 'DeepSeek', expected: 'navigation',
    }, signal)).rejects.toMatchObject({ code: 'INVALID_ACTION' })
    expect(provider.execute).not.toHaveBeenCalled()
  })

  it('preserves the final page state and invalidates the snapshot when only the action postcondition fails', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, signal })
    await runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'snapshot' }, signal)
    provider.execute.mockImplementationOnce(async (_context, tab) => {
      const finalTab = { ...tab, url: 'https://example.test/partial', title: 'Partial' }
      throw new BrowserRuntimeError('POSTCONDITION_TIMEOUT', 'Action completed, but navigation did not occur.', {
        actionApplied: true, completedSteps: 1, failedPhase: 'postcondition', postcondition: 'navigation', durationMs: 30_000, finalUrl: finalTab.url, finalTab,
      })
    })

    await expect(runtime.execute('agent-1', created.tab.tabId, {
      kind: 'act', action: 'click', locator: { kind: 'node', snapshotId: 'snapshot-1', nodeRef: 'n1' }, expected: 'navigation',
    }, signal)).rejects.toMatchObject({ code: 'POSTCONDITION_TIMEOUT', details: expect.objectContaining({ actionApplied: true, completedSteps: 1, failedPhase: 'postcondition' }) })
    expect(runtime.tab('agent-1', created.tab.tabId)).toMatchObject({ url: 'https://example.test/partial', title: 'Partial' })
    expect(runtime.tab('agent-1', created.tab.tabId).snapshotId).toBeUndefined()
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'events' }, signal)).resolves.toMatchObject({
      events: expect.arrayContaining([expect.objectContaining({ kind: 'snapshot-invalidated' }), expect.objectContaining({ kind: 'postcondition-failed', detail: 'navigation' })]),
    })
  })

  it('bounds and redacts the model-facing Browser event ledger', async () => {
    const provider = background(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'background' }, url: 'http://127.0.0.1/?access_token=secret', signal })
    for (let index = 0; index < 30; index++) await runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'title' }, signal)
    const result = await runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'events' }, signal)
    if (result.kind !== 'events') throw new Error('Expected Browser events.')
    expect(result.events).toHaveLength(50)
    expect(JSON.stringify(result.events)).not.toContain('access_token=secret')
    expect(JSON.stringify(result.events)).toContain('access_token=%5BREDACTED%5D')
  })

  it('lets an explicit panel address action navigate while interrupting Agent control', async () => {
    const provider = visible(); const runtime = new BrowserRuntime(); runtime.registerProvider(provider)
    const created = await runtime.createTab({ sessionId: 'agent-1', turn: 0, workspaceRoot: process.cwd(), selection: { browserId: 'visible' }, lifecycle: 'deliverable', signal })
    runtime.markPresentationPending('agent-1', created.tab.tabId)
    runtime.settlePresentation('agent-1', created.tab.tabId, 'presented')

    await expect(runtime.navigateFromClient('agent-1', created.tab.tabId, 'http://127.0.0.1:4173/path', signal)).resolves.toMatchObject({
      url: 'http://127.0.0.1:4173/path', controlState: 'interrupted', lifecycle: 'deliverable',
    })
    await expect(runtime.execute('agent-1', created.tab.tabId, { kind: 'inspect', action: 'title' }, signal)).rejects.toMatchObject({ code: 'CONTROL_INTERRUPTED' })
    expect(provider.execute).toHaveBeenCalledWith(expect.anything(), expect.anything(), { kind: 'navigate', action: 'goto', url: 'http://127.0.0.1:4173/path' })
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
