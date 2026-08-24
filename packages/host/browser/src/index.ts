import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-presentation'
import type { OpenInDeepCreatorResult, PresentationResource } from '@ryanyujazz/dsh-presentation/types'
import { BrowserRuntimeError, browserFailure } from './errors.ts'
import { BrowserRuntime } from './runtime.ts'
import { createBrowserToolDefinitions } from './tools.ts'
import { BROWSER_SETTINGS_KEY, BrowserSettingsSchema, type BrowserSettings } from './settings.ts'
import type { BrowserNextAction, BrowserProvider, BrowserRemoteResult, BrowserStateSnapshot, BrowserTabState } from './types.ts'

export * from './errors.ts'
export * from './action.ts'
export * from './network-policy.ts'
export * from './model-sanitization.ts'
export * from './provider-conformance.ts'
export * from './runtime.ts'
export * from './settings.ts'
export * from './snapshot-script.ts'
export * from './types.ts'
export * from './url-match.ts'
export * from './workspace-file-policy.ts'

export const name = 'browser-runtime'
export const inject = ['agents', 'tools', 'approval', 'attachments', 'presentationRuntime']
export interface Config {
  allowPrivateNetwork?: boolean
  defaultAutomation?: 'semantic' | 'playwright'
  defaultEngine?: 'chromium' | 'firefox' | 'webkit'
  visibleProviderOrder?: string[]
}

declare module '@deepseek-ai/cordis' { interface Context { browserRuntime: BrowserHostService } }

export function isBrowserToolOwner(agents: { roots(): readonly Agent[] }, agent: Agent): boolean { return agents.roots().includes(agent) }

export function shouldCloseAfterFailedPresentation(tab: BrowserTabState, resolverCreatedTab: boolean): boolean {
  return resolverCreatedTab || (tab.lifecycle === 'temporary' && tab.presentationBinding.owner === 'deepcreator'
    && tab.controlState === 'presentation-required' && tab.presentationState === 'pending')
}

declare module '@ryanyujazz/dsh-presentation/types' {
  interface PresentationInputMap {
    url: { url: string; browserId?: string }
    'browser-tab': { tabId: string }
  }
}

/** Host-owned Browser Runtime and Provider contributions. Presentation remains an independent service. */
export class BrowserHostService extends TypertRemoteService {
  static inject = inject
  // This service is consumed through Cordis' Proxy-backed injection surface;
  // native `#private` fields are therefore invalid receivers in public calls.
  private readonly browser: BrowserRuntime
  private readonly turns = new Map<string, number>()
  private userTabSequence = 0

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserRuntime', { namespace: 'browser' })
    this.browser = new BrowserRuntime({ ...config, attachments: ctx.attachments })
    ctx.inject(['settings'], settingsCtx => settingsCtx.settings.register(BROWSER_SETTINGS_KEY, BrowserSettingsSchema))
    const resolverDisposers = this.registerResolvers(ctx)

    ctx.on('agent/session-start', ({ agent }: { agent: Agent }) => {
      if (!isBrowserToolOwner(ctx.agents, agent)) return
      agent.ctx.effect(() => {
        const definitions = createBrowserToolDefinitions({
          runtime: this.browser, approval: ctx.approval,
          turnOf: candidate => this.turnOf(candidate),
        })
        const disposers = definitions.map(definition => agent.ctx.tools.register(definition))
        return () => { for (const dispose of disposers.reverse()) dispose() }
      }, 'browser-runtime: root-agent tools')
    })
    ctx.on('agent/pre-step', async ({ agent, turn }: { agent: Agent; turn: number }, next: () => Promise<PreStepDecision>) => {
      const settings = ctx.get('settings')?.get(BROWSER_SETTINGS_KEY) as BrowserSettings | undefined
      if (settings !== undefined) this.browser.configure({ defaultAutomation: settings.defaultAutomation, defaultEngine: settings.playwrightDefaultEngine, visibleProviderOrder: settings.visibleProviderOrder })
      this.turns.set(String(agent.id), turn)
      return next()
    })
    ctx.on('agent/turn-stopping', async ({ agent, turn }: { agent: Agent; turn: number }) => {
      await this.browser.endTurn(String(agent.id), turn)
      this.turns.delete(String(agent.id))
    })
    ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
      const turn = this.turns.get(String(agent.id))
      if (turn !== undefined) void this.browser.endTurn(String(agent.id), turn)
      this.turns.delete(String(agent.id))
    })
    ctx.effect(() => () => { for (const dispose of resolverDisposers.reverse()) dispose(); void this.browser.dispose() }, 'browser-runtime: dispose')
  }

  registerBrowserProvider(provider: BrowserProvider): () => void { return this.browser.registerProvider(provider) }
  providerRuntime(): BrowserRuntime { return this.browser }
  currentTurn(agent: Agent): number { return this.turnOf(agent) }

  @Remote('state')
  state(agent: Agent): BrowserRemoteResult<BrowserStateSnapshot> {
    try { return { ok: true, value: this.browser.state(String(agent.id)) } }
    catch (error) { return browserFailure(error) }
  }

  @Remote('waitStateRevision')
  async waitStateRevision(agent: Agent, afterRevision: number): Promise<BrowserRemoteResult<{ revision: number }>> {
    try { return { ok: true, value: { revision: await this.browser.waitForRevision(String(agent.id), afterRevision, AbortSignal.timeout(25_000)) } } }
    catch (error) { return browserFailure(error) }
  }

  @Remote('closeTab')
  async closeTab(agent: Agent, tabId: string): Promise<BrowserRemoteResult<{ closed: true; tabId: string }>> {
    try {
      await this.browser.close(String(agent.id), tabId, AbortSignal.timeout(5_000))
      return { ok: true, value: { closed: true, tabId } }
    } catch (error) { return browserFailure(error) }
  }

  /** Explicit user action: create one persistent blank built-in Browser tab. */
  @Remote('newTab')
  async newTab(agent: Agent): Promise<BrowserRemoteResult<{ tab: BrowserTabState; nextAction: BrowserNextAction }>> {
    const sessionId = String(agent.id)
    try {
      const created = await this.browser.createTab({
        sessionId,
        // Keep client-owned tabs outside Agent turn numbers. Their deliverable
        // lifecycle means they remain until the user closes the exact tab.
        turn: -1_000_000_000 - (++this.userTabSequence),
        workspaceRoot: agent.session.header.cwd ?? process.cwd(),
        selection: { preference: { browserId: 'iab' } },
        lifecycle: 'deliverable',
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: true, value: created }
    } catch (error) { return browserFailure(error) }
  }

  /** Explicit user action: navigate the exact logical tab from the panel URL bar. */
  @Remote('navigateTab')
  async navigateTab(agent: Agent, tabId: string, url: string): Promise<BrowserRemoteResult<{ tab: BrowserTabState }>> {
    try {
      const tab = await this.browser.navigateFromClient(String(agent.id), tabId, url, AbortSignal.timeout(30_000))
      return { ok: true, value: { tab } }
    } catch (error) { return browserFailure(error) }
  }

  @Remote('clearBrowserData')
  async clearBrowserData(browserId: string): Promise<BrowserRemoteResult<{ cleared: string[]; unavailable: string[] }>> {
    const ids = browserId === 'all' ? this.browser.descriptors().map(browser => browser.browserId) : [browserId]
    const cleared: string[] = []; const unavailable: string[] = []
    for (const id of ids) {
      try { await this.browser.clearProviderData(id); cleared.push(id) }
      catch (error) {
        if (browserId !== 'all') return browserFailure(error)
        unavailable.push(id)
      }
    }
    return { ok: true, value: { cleared, unavailable } }
  }

  @Remote('snapshotImage')
  async snapshotImage(agent: Agent, tabId: string): Promise<BrowserRemoteResult<{ attachment: ImageAttachmentRef; artifactId: string; dataUrl: string }>> {
    try { return { ok: true, value: await this.browser.screenshotImage(String(agent.id), tabId) } }
    catch (error) { return browserFailure(error) }
  }

  @Remote('manageProvider')
  async manageProvider(browserId: string, action: 'install' | 'repair' | 'uninstall'): Promise<BrowserRemoteResult<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }>> {
    try { return { ok: true, value: await this.browser.manageProvider(browserId, action) } }
    catch (error) { return browserFailure(error) }
  }

  private turnOf(agent: Agent): number {
    const turn = this.turns.get(String(agent.id))
    if (turn === undefined) throw new Error('Browser tools require an open Agent turn.')
    return turn
  }

  private registerResolvers(ctx: Context): Array<() => void> {
    const prepareSnapshot = async (context: { sessionId: string; signal: { readonly aborted: boolean } }, tab: BrowserTabState) => {
      const presentationMode = tab.presentationBinding.owner === 'provider' ? 'snapshot' : tab.presentation
      if (presentationMode !== 'snapshot' || tab.snapshotAttachment !== undefined) return
      await this.browser.execute(context.sessionId, tab.tabId, { kind: 'inspect', action: 'screenshot' }, context.signal)
    }
    const settle = async (context: { sessionId: string; signal: { readonly aborted: boolean }; result: OpenInDeepCreatorResult }, resource: PresentationResource, rollback: boolean) => {
      let rollbackUnpresentedTemporaryTab = false
      try {
        const tab = this.browser.tab(context.sessionId, resource.id)
        rollbackUnpresentedTemporaryTab = shouldCloseAfterFailedPresentation(tab, rollback)
      } catch { /* The resource may not be Browser-owned or may already have been cleaned up. */ }
      try { this.browser.settlePresentation(context.sessionId, resource.id, context.result.status) }
      catch { return }
      if (rollback && context.result.status === 'presented') this.browser.markLifecycle(context.sessionId, resource.id, 'deliverable')
      if (rollbackUnpresentedTemporaryTab && context.result.status !== 'presented') {
        await this.browser.close(context.sessionId, resource.id, AbortSignal.timeout(5_000), 'presentation-rollback').catch(() => undefined)
      }
    }
    const disposers: Array<() => void> = []
    disposers.push(ctx.presentationRuntime.registerResolver({
      kind: 'url',
      description: 'Open a URL inside DeepCreator using a live built-in Surface or managed snapshot and present the exact resulting tab. Provider-owned system windows such as Chrome are never opened implicitly. Fields: kind="url", url, optional browserId.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'url', required: true }, url: { type: 'string', required: true }, browserId: { type: 'string' },
      } },
      parse: input => {
        const value = input as Record<string, unknown>
        if (value.kind !== 'url' || typeof value.url !== 'string' || (value.browserId !== undefined && typeof value.browserId !== 'string')) throw new Error('url presentation requires string url and optional string browserId.')
        return { kind: 'url' as const, url: value.url, ...(value.browserId === undefined ? {} : { browserId: value.browserId }) }
      },
      materialize: async (context, input) => {
        let created
        if (input.browserId !== undefined) {
          const selected = this.browser.resolve({ preference: { browserId: input.browserId } }).browser
          if (selected.presentation.owner === 'provider' && selected.presentation.mode === 'live') throw new BrowserRuntimeError('PRESENTATION_UNAVAILABLE', `${input.browserId} owns its system-visible window and cannot be opened implicitly by open_in_deepcreator({kind:"url"}). Create or claim it with browser_tabs, then explicitly present that browser-tab as a snapshot if desired.`)
          created = await this.browser.createTab({ sessionId: context.sessionId, turn: context.turn, workspaceRoot: context.workspaceRoot, selection: { preference: { browserId: input.browserId } }, url: input.url, signal: context.signal })
        } else {
          try { created = await this.browser.createTab({ sessionId: context.sessionId, turn: context.turn, workspaceRoot: context.workspaceRoot, selection: { requirements: { visibility: 'live', capabilities: ['presentation.deepcreator-surface'] } }, url: input.url, signal: context.signal }) }
          catch (error) {
            if (!(error instanceof BrowserRuntimeError) || !['BROWSER_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'CAPABILITY_UNSUPPORTED'].includes(error.code)) throw error
            created = await this.browser.createTab({ sessionId: context.sessionId, turn: context.turn, workspaceRoot: context.workspaceRoot, selection: { requirements: { visibility: 'background', automation: 'playwright' } }, url: input.url, signal: context.signal })
          }
        }
        await prepareSnapshot(context, created.tab)
        this.browser.markPresentationPending(context.sessionId, created.tab.tabId)
        return { kind: 'browser-tab', id: created.tab.tabId, mode: created.tab.presentationBinding.owner === 'provider' ? 'snapshot' : created.tab.presentation, metadata: { browserId: created.tab.browserId, url: created.tab.url } }
      },
      settle: async (context, _input, resource) => settle(context, resource, true),
    }))
    disposers.push(ctx.presentationRuntime.registerResolver({
      kind: 'browser-tab',
      description: 'Present an existing logical Browser tab. Fields: kind="browser-tab", tabId.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'browser-tab', required: true }, tabId: { type: 'string', required: true },
      } },
      parse: input => {
        const value = input as Record<string, unknown>
        if (value.kind !== 'browser-tab' || typeof value.tabId !== 'string') throw new Error('browser-tab presentation requires string tabId.')
        return { kind: 'browser-tab' as const, tabId: value.tabId }
      },
      materialize: async (context, input) => {
        const tab = this.browser.tab(context.sessionId, input.tabId)
        await prepareSnapshot(context, tab)
        this.browser.markPresentationPending(context.sessionId, tab.tabId)
        return { kind: 'browser-tab', id: tab.tabId, mode: tab.presentationBinding.owner === 'provider' ? 'snapshot' : tab.presentation, metadata: { browserId: tab.browserId, url: tab.url } }
      },
      settle: async (context, _input, resource) => settle(context, resource, false),
    }))
    return disposers
  }
}

export default BrowserHostService
