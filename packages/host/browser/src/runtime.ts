import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { BrowserRuntimeError } from './errors.ts'
import { BrowserNetworkPolicy } from './network-policy.ts'
import type {
  BrowserCapability, BrowserCommand, BrowserCommandResult, BrowserDescriptor, BrowserNextAction, BrowserProvider,
  BrowserProviderBinding, BrowserProviderContext, BrowserRequirementAssessment, BrowserRequirements, BrowserResolution,
  BrowserSelectionRequest, BrowserSignalInput, BrowserStateSnapshot, BrowserTabLifecycle, BrowserTabState, ProviderTab, UserTabCandidate,
} from './types.ts'
import { browserSignal } from './types.ts'

interface ManagedTab {
  state: BrowserTabState
  providerTab: ProviderTab
  ownerSessionId: string
  automationSessionId: string
  workspaceRoot: string
  turn: number
  interrupted: boolean
  queue: Promise<void>
}
interface RevisionWaiter { after: number; resolve(revision: number): void; timer: NodeJS.Timeout; abort(): void }

export interface RuntimeTabResult { tab: BrowserTabState; nextAction: BrowserNextAction }

export interface BrowserRuntimeOptions {
  allowPrivateNetwork?: boolean
  visibleProviderOrder?: string[]
  defaultAutomation?: 'semantic' | 'playwright'
  defaultEngine?: 'chromium' | 'firefox' | 'webkit'
}

const LEGACY_CAPABILITIES: Record<string, BrowserCapability> = {
  tabs: 'core.tabs', navigation: 'core.navigation', snapshot: 'core.snapshot', screenshot: 'core.screenshot',
  'semantic-actions': 'core.semantic-actions', wait: 'core.wait', upload: 'io.upload', download: 'io.download',
  'user-tabs': 'profile.user-tabs', 'manual-takeover': 'interaction.manual-handoff', 'live-surface': 'presentation.deepcreator-surface',
}

export class BrowserRuntime {
  readonly #providers = new Map<string, BrowserProvider>()
  readonly #tabs = new Map<string, ManagedTab>()
  readonly #revisions = new Map<string, number>()
  readonly #selected = new Map<string, string>()
  readonly #revisionWaiters = new Map<string, Set<RevisionWaiter>>()
  readonly networkPolicy: BrowserNetworkPolicy
  #visibleProviderOrder: string[]
  #defaultAutomation: 'semantic' | 'playwright'
  #defaultEngine: 'chromium' | 'firefox' | 'webkit'

  constructor(options: BrowserRuntimeOptions = {}) {
    this.networkPolicy = new BrowserNetworkPolicy(options)
    this.#visibleProviderOrder = options.visibleProviderOrder ?? ['iab', 'chrome', 'playwright-chromium']
    this.#defaultAutomation = options.defaultAutomation ?? 'playwright'
    this.#defaultEngine = options.defaultEngine ?? 'chromium'
  }

  configure(options: Pick<BrowserRuntimeOptions, 'visibleProviderOrder' | 'defaultAutomation' | 'defaultEngine'>): void {
    if (options.visibleProviderOrder !== undefined && options.visibleProviderOrder.length > 0) this.#visibleProviderOrder = [...options.visibleProviderOrder]
    if (options.defaultAutomation !== undefined) this.#defaultAutomation = options.defaultAutomation
    if (options.defaultEngine !== undefined) this.#defaultEngine = options.defaultEngine
  }

  registerProvider(provider: BrowserProvider): () => void {
    const descriptor = provider.descriptor()
    if (this.#providers.has(descriptor.browserId)) throw new Error(`browser provider already registered: ${descriptor.browserId}`)
    this.#providers.set(descriptor.browserId, provider)
    return () => { if (this.#providers.get(descriptor.browserId) === provider) this.#providers.delete(descriptor.browserId) }
  }

  descriptors(): BrowserDescriptor[] { return [...this.#providers.values()].map(provider => provider.descriptor()) }
  providerChanged(): void { for (const sessionId of this.#revisions.keys()) this.#bump(sessionId) }

  resolve(request: BrowserSelectionRequest = {}): BrowserResolution {
    const normalized = this.#normalizeSelection(request)
    const descriptors = this.descriptors()
    const assessments = descriptors.map(descriptor => this.#assess(descriptor, normalized.requirements))
    const explicitId = normalized.preference?.browserId
    if (explicitId !== undefined) {
      const resolvedId = explicitId === 'headless' ? 'playwright-chromium' : explicitId
      const provider = this.#providers.get(resolvedId)
      if (provider === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Browser provider ${explicitId} is not registered.`)
      const assessment = this.#assess(provider.descriptor(), normalized.requirements)
      if (!assessment.satisfied) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${explicitId} does not satisfy: ${assessment.missing.join(', ')}.`, { assessments, requirements: normalized.requirements, preference: normalized.preference })
      return { browser: provider.descriptor(), reasons: [`explicit browserId ${explicitId}`], assessments }
    }
    const candidates = [...this.#providers.values()].filter(provider => {
      const descriptor = provider.descriptor()
      if (normalized.preference?.family !== undefined && descriptor.family !== normalized.preference.family) return false
      if (normalized.preference?.providerKind !== undefined && descriptor.providerKind !== normalized.preference.providerKind) return false
      return this.#assess(descriptor, normalized.requirements).satisfied
    })
    candidates.sort((left, right) => this.#score(left.descriptor(), normalized.requirements) - this.#score(right.descriptor(), normalized.requirements))
    const selected = candidates[0]
    if (selected === undefined) {
      const detail = assessments.map(item => `${item.browserId}: ${item.missing.join(', ') || 'filtered by preference'}`).join('; ')
      throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `No Browser provider satisfies the requested requirements. ${detail}`, { assessments, requirements: normalized.requirements, ...(normalized.preference === undefined ? {} : { preference: normalized.preference }) })
    }
    const descriptor = selected.descriptor()
    return {
      browser: descriptor,
      reasons: [normalized.requirements.visibility === 'live' ? 'matched live visibility preference' : `default ${normalized.requirements.automation ?? this.#defaultAutomation} automation`, `selected ${descriptor.browserId}`],
      assessments,
    }
  }

  select(request: BrowserSelectionRequest = {}): BrowserProvider {
    const descriptor = this.resolve(request).browser
    return this.#providers.get(descriptor.browserId)!
  }

  async createTab(input: {
    sessionId: string; turn: number; workspaceRoot: string; selection?: BrowserSelectionRequest
    url?: string; lifecycle?: BrowserTabLifecycle; tabRequirements?: BrowserRequirements; signal: BrowserSignalInput
  }): Promise<RuntimeTabResult> {
    const selection = this.#normalizeSelection(input.selection ?? {})
    selection.requirements.capabilities = [...(selection.requirements.capabilities ?? []), 'core.tabs']
    const provider = this.select(selection)
    if (input.url !== undefined) await this.networkPolicy.assertAllowed(input.url)
    const automationSessionId = `${input.sessionId}:${input.turn}`
    const context = this.#context(automationSessionId, input.workspaceRoot, input.signal)
    const providerTab = await provider.createTab(context, {
      ...(input.url === undefined ? {} : { url: input.url }),
      lifecycle: input.lifecycle ?? 'temporary', requirements: { ...selection.requirements, ...input.tabRequirements },
    })
    const descriptor = provider.descriptor()
    const tabId = `tab-${randomUUID()}`
    const presentationBinding = providerTab.presentation ?? descriptor.presentation
    const presentationRequired = presentationBinding.owner === 'deepcreator' && presentationBinding.requiredBeforeControl
    const lifecycle = input.lifecycle ?? (presentationBinding.owner === 'provider' && presentationBinding.mode === 'live' ? 'deliverable' : 'temporary')
    const state: BrowserTabState = {
      tabId, browserId: descriptor.browserId, url: providerTab.url, title: providerTab.title,
      loading: providerTab.loading, canGoBack: providerTab.canGoBack, canGoForward: providerTab.canGoForward,
      lifecycle, presentation: presentationBinding.mode, presentationBinding,
      controlState: presentationRequired ? 'presentation-required' : 'ready', presentationState: 'not-requested',
      ...(providerTab.surfaceId === undefined ? {} : { surfaceId: providerTab.surfaceId }),
    }
    this.#tabs.set(tabId, { state, providerTab, ownerSessionId: input.sessionId, automationSessionId, workspaceRoot: input.workspaceRoot, turn: input.turn, interrupted: false, queue: Promise.resolve() })
    this.#selected.set(input.sessionId, tabId)
    this.#bump(input.sessionId)
    return { tab: { ...state }, nextAction: this.#nextAction(state) }
  }

  /** Adopt a Provider-created page (for example page/context APIs inside playwright_run) into the logical Tab model. */
  adoptProviderTab(input: {
    sessionId: string; turn: number; workspaceRoot: string; browserId: string; providerTab: ProviderTab
    lifecycle?: BrowserTabLifecycle
  }): RuntimeTabResult {
    const provider = this.#providers.get(input.browserId)
    if (provider === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Provider ${input.browserId} is unavailable.`)
    const existing = [...this.#tabs.values()].find(tab => tab.state.browserId === input.browserId && tab.providerTab.providerTabId === input.providerTab.providerTabId)
    if (existing !== undefined) return { tab: { ...existing.state }, nextAction: this.#nextAction(existing.state) }
    const descriptor = provider.descriptor()
    const presentationBinding = input.providerTab.presentation ?? descriptor.presentation
    const presentationRequired = presentationBinding.owner === 'deepcreator' && presentationBinding.requiredBeforeControl
    const lifecycle = input.lifecycle ?? (presentationBinding.owner === 'provider' && presentationBinding.mode === 'live' ? 'deliverable' : 'temporary')
    const tabId = `tab-${randomUUID()}`
    const state: BrowserTabState = {
      tabId, browserId: descriptor.browserId, url: input.providerTab.url, title: input.providerTab.title,
      loading: input.providerTab.loading, canGoBack: input.providerTab.canGoBack, canGoForward: input.providerTab.canGoForward,
      lifecycle, presentation: presentationBinding.mode, presentationBinding,
      controlState: presentationRequired ? 'presentation-required' : 'ready', presentationState: 'not-requested',
      ...(input.providerTab.surfaceId === undefined ? {} : { surfaceId: input.providerTab.surfaceId }),
    }
    const automationSessionId = `${input.sessionId}:${input.turn}`
    this.#tabs.set(tabId, { state, providerTab: input.providerTab, ownerSessionId: input.sessionId, automationSessionId, workspaceRoot: input.workspaceRoot, turn: input.turn, interrupted: false, queue: Promise.resolve() })
    this.#selected.set(input.sessionId, tabId)
    this.#bump(input.sessionId)
    return { tab: { ...state }, nextAction: this.#nextAction(state) }
  }

  async execute(sessionId: string, tabId: string, command: BrowserCommand, signal: BrowserSignalInput): Promise<BrowserCommandResult> {
    const managed = this.#owned(sessionId, tabId)
    const previous = managed.queue
    let release!: () => void
    const occupied = new Promise<void>(resolve => { release = resolve })
    managed.queue = previous.catch(() => undefined).then(() => occupied)
    await previous.catch(() => undefined)
    try { return await this.#executeNow(sessionId, tabId, managed, command, signal) }
    finally { release() }
  }

  async #executeNow(sessionId: string, tabId: string, managed: ManagedTab, command: BrowserCommand, signal: BrowserSignalInput): Promise<BrowserCommandResult> {
    if (signal.aborted) throw new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Browser command was cancelled before execution.')
    if (managed.interrupted || managed.state.controlState === 'interrupted' || managed.state.controlState === 'user-control') throw new BrowserRuntimeError('CONTROL_INTERRUPTED', 'The user has control of this browser tab. Resume control explicitly before continuing.')
    if (managed.state.controlState === 'presentation-required') {
      const guidance = managed.state.presentationState === 'unavailable'
        ? 'Its stable presentation attempt already failed; do not retry or control this tab during the current turn.'
        : 'Present it once with open_in_deepcreator before controlling it.'
      throw new BrowserRuntimeError('PRESENTATION_UNAVAILABLE', `This built-in browser tab is not user-visible (presentationState=${managed.state.presentationState}). ${guidance}`)
    }
    if (command.kind === 'navigate' && command.action === 'goto') {
      if (command.url === undefined) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'goto requires a URL.')
      await this.networkPolicy.assertAllowed(command.url)
    }
    const locator = 'locator' in command ? command.locator : undefined
    if (locator?.kind === 'node' && managed.state.snapshotId !== locator.snapshotId) {
      throw new BrowserRuntimeError('STALE_SNAPSHOT', `Snapshot ${locator.snapshotId} is no longer current for ${tabId}.`)
    }
    const destination = command.kind === 'act' ? command.destination : undefined
    if (destination?.kind === 'node' && managed.state.snapshotId !== destination.snapshotId) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Destination snapshot ${destination.snapshotId} is no longer current for ${tabId}.`)
    const provider = this.#providers.get(managed.state.browserId)
    if (provider === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Provider ${managed.state.browserId} is unavailable.`)
    try {
      const result = await provider.execute(this.#context(managed.automationSessionId, managed.workspaceRoot, signal), managed.providerTab, command)
      managed.providerTab = result.tab
      this.#syncState(managed, result.tab)
      managed.state.lastAction = { action: `${command.kind}:${'action' in command ? command.action : command.condition}`, at: Date.now(), result: 'ok' }
      if (result.kind === 'snapshot') managed.state.snapshotId = result.snapshot.snapshotId
      else if (result.kind === 'screenshot') managed.state.snapshotArtifactId = await this.persistScreenshot(sessionId, tabId, result.dataUrl)
      else if (command.kind !== 'inspect') delete managed.state.snapshotId
      this.#selected.set(sessionId, tabId)
      this.#bump(sessionId)
      return result
    } catch (error) {
      const code = error instanceof BrowserRuntimeError ? error.code : 'BROWSER_UNAVAILABLE'
      managed.state.lastAction = { action: command.kind, at: Date.now(), result: code }
      this.#bump(sessionId)
      throw error
    }
  }

  markPresentationPending(sessionId: string, tabId: string): void {
    const managed = this.#owned(sessionId, tabId)
    managed.state.presentationState = 'pending'
    this.#bump(sessionId)
  }

  settlePresentation(sessionId: string, tabId: string, status: 'presented' | 'suppressed' | 'unavailable'): void {
    const managed = this.#owned(sessionId, tabId)
    managed.state.presentationState = status === 'suppressed' ? 'dismissed' : status
    if (status === 'presented') {
      managed.state.controlState = 'ready'; managed.interrupted = false
      // A live page acknowledged as visible is now a user-owned result, not turn scratch space.
      if (managed.state.presentationBinding.owner === 'deepcreator' && managed.state.presentation === 'live' && managed.state.lifecycle === 'temporary') managed.state.lifecycle = 'deliverable'
    }
    else if (managed.state.presentation === 'live' && managed.state.controlState !== 'ready') managed.state.controlState = 'presentation-required'
    this.#bump(sessionId)
  }

  reacquire(sessionId: string, tabId: string): BrowserTabState {
    const managed = this.#owned(sessionId, tabId)
    managed.interrupted = false
    managed.state.controlState = managed.state.presentationBinding.owner === 'deepcreator' && managed.state.presentationBinding.requiredBeforeControl && managed.state.presentationState !== 'presented' ? 'presentation-required' : 'ready'
    this.#bump(sessionId)
    return { ...managed.state }
  }

  interruptBySurface(surfaceId: string): void {
    const managed = [...this.#tabs.values()].find(tab => tab.state.surfaceId === surfaceId)
    if (managed === undefined) return
    this.#interrupt(managed)
  }

  interruptByProviderTab(browserId: string, providerTabId: string): void {
    const managed = [...this.#tabs.values()].find(tab => tab.state.browserId === browserId && tab.providerTab.providerTabId === providerTabId)
    if (managed === undefined) return
    this.#interrupt(managed)
  }

  #interrupt(managed: ManagedTab): void {
    managed.interrupted = true
    managed.state.controlState = 'interrupted'
    managed.state.lastAction = { action: 'user-input', at: Date.now(), result: 'CONTROL_INTERRUPTED' }
    this.#bump(managed.ownerSessionId)
  }

  async refreshProviderTab(browserId: string, providerTabId: string): Promise<void> {
    const managed = [...this.#tabs.values()].find(tab => tab.state.browserId === browserId && tab.providerTab.providerTabId === providerTabId)
    if (managed === undefined) return
    const provider = this.#providers.get(browserId)
    if (provider === undefined) return
    const tabs = await provider.listAgentTabs(this.#context(managed.automationSessionId, managed.workspaceRoot, AbortSignal.timeout(2_000)))
    const current = tabs.find(tab => tab.providerTabId === providerTabId)
    if (current === undefined) return
    managed.providerTab = current
    this.#syncState(managed, current)
    delete managed.state.snapshotId
    this.#bump(managed.ownerSessionId)
  }

  async claimUserTab(input: { sessionId: string; turn: number; workspaceRoot: string; browserId: string; candidate: UserTabCandidate; signal: BrowserSignalInput }): Promise<RuntimeTabResult> {
    const provider = this.select({ preference: { browserId: input.browserId }, requirements: { capabilities: ['profile.user-tabs'], visibility: 'live', profile: 'user' } })
    if (provider.claimUserTab === undefined) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${input.browserId} cannot claim user tabs.`)
    const automationSessionId = `${input.sessionId}:${input.turn}`
    const providerTab = await provider.claimUserTab(this.#context(automationSessionId, input.workspaceRoot, input.signal), input.candidate)
    const descriptor = provider.descriptor()
    const tabId = `tab-${randomUUID()}`
    const presentationBinding = providerTab.presentation ?? descriptor.presentation
    const state: BrowserTabState = {
      tabId, browserId: descriptor.browserId, url: providerTab.url, title: providerTab.title,
      loading: providerTab.loading, canGoBack: providerTab.canGoBack, canGoForward: providerTab.canGoForward,
      lifecycle: 'claimed', presentation: presentationBinding.mode, presentationBinding,
      controlState: presentationBinding.owner === 'deepcreator' && presentationBinding.requiredBeforeControl ? 'presentation-required' : 'ready', presentationState: 'not-requested',
      ...(providerTab.surfaceId === undefined ? {} : { surfaceId: providerTab.surfaceId }),
    }
    this.#tabs.set(tabId, { state, providerTab, ownerSessionId: input.sessionId, automationSessionId, workspaceRoot: input.workspaceRoot, turn: input.turn, interrupted: false, queue: Promise.resolve() })
    this.#bump(input.sessionId)
    return { tab: { ...state }, nextAction: this.#nextAction(state) }
  }

  async listUserTabs(sessionId: string, browserId: string, workspaceRoot: string, signal: BrowserSignalInput): Promise<UserTabCandidate[]> {
    const provider = this.select({ preference: { browserId }, requirements: { capabilities: ['profile.user-tabs'], visibility: 'live', profile: 'user' } })
    if (provider.listUserTabs === undefined) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${browserId} cannot list user tabs.`)
    return provider.listUserTabs(this.#context(`${sessionId}:user-tabs`, workspaceRoot, signal))
  }

  async show(sessionId: string, tabId: string, signal: BrowserSignalInput): Promise<BrowserTabState> {
    const managed = this.#owned(sessionId, tabId)
    const provider = this.#providers.get(managed.state.browserId)
    if (provider?.show === undefined) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${managed.state.browserId} cannot show or focus a tab.`)
    managed.providerTab = await provider.show(this.#context(managed.automationSessionId, managed.workspaceRoot, signal), managed.providerTab)
    this.#syncState(managed, managed.providerTab)
    if (managed.state.presentationBinding.mode === 'live' && managed.state.presentationBinding.owner === 'provider' && managed.state.lifecycle === 'temporary') managed.state.lifecycle = 'deliverable'
    this.#bump(sessionId)
    return { ...managed.state }
  }

  async handoffToUser(sessionId: string, tabId: string, signal: BrowserSignalInput): Promise<BrowserTabState> {
    const managed = this.#owned(sessionId, tabId)
    const provider = this.#providers.get(managed.state.browserId)
    if (!provider?.descriptor().capabilities.includes('interaction.manual-handoff')) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${managed.state.browserId} does not support manual handoff.`)
    if (provider.handoffToUser !== undefined) managed.providerTab = await provider.handoffToUser(this.#context(managed.automationSessionId, managed.workspaceRoot, signal), managed.providerTab)
    managed.interrupted = true
    managed.state.controlState = 'user-control'
    this.#syncState(managed, managed.providerTab)
    this.#bump(sessionId)
    return { ...managed.state }
  }

  async resumeControl(sessionId: string, tabId: string, signal: BrowserSignalInput): Promise<BrowserTabState> {
    const managed = this.#owned(sessionId, tabId)
    const provider = this.#providers.get(managed.state.browserId)
    if (provider?.resumeControl !== undefined) managed.providerTab = await provider.resumeControl(this.#context(managed.automationSessionId, managed.workspaceRoot, signal), managed.providerTab)
    managed.interrupted = false
    this.#syncState(managed, managed.providerTab)
    managed.state.controlState = managed.state.presentationBinding.owner === 'deepcreator' && managed.state.presentationBinding.requiredBeforeControl && managed.state.presentationState !== 'presented' ? 'presentation-required' : 'ready'
    this.#bump(sessionId)
    return { ...managed.state }
  }

  providerBinding(sessionId: string, tabId: string, signal: BrowserSignalInput, capability?: BrowserCapability): BrowserProviderBinding {
    const managed = this.#owned(sessionId, tabId)
    const provider = this.#providers.get(managed.state.browserId)
    if (provider === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Provider ${managed.state.browserId} is unavailable.`)
    if (capability !== undefined && !provider.descriptor().capabilities.includes(capability)) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${managed.state.browserId} lacks ${capability}.`)
    return { tab: { ...managed.state }, provider, providerTab: managed.providerTab, context: this.#context(managed.automationSessionId, managed.workspaceRoot, signal) }
  }

  markLifecycle(sessionId: string, tabId: string, lifecycle: Extract<BrowserTabLifecycle, 'deliverable' | 'handoff'>): BrowserTabState {
    const managed = this.#owned(sessionId, tabId)
    managed.state.lifecycle = lifecycle
    this.#bump(sessionId)
    return { ...managed.state }
  }

  async close(sessionId: string, tabId: string, signal: BrowserSignalInput): Promise<void> {
    const managed = this.#owned(sessionId, tabId)
    await this.#drain(managed)
    const provider = this.#providers.get(managed.state.browserId)
    if (provider !== undefined) await provider.close(this.#context(managed.automationSessionId, managed.workspaceRoot, signal), managed.providerTab)
    this.#tabs.delete(tabId)
    if (this.#selected.get(sessionId) === tabId) this.#selected.delete(sessionId)
    this.#bump(sessionId)
  }

  async endTurn(sessionId: string, turn: number): Promise<void> {
    for (const [tabId, managed] of [...this.#tabs]) {
      if (managed.ownerSessionId !== sessionId || managed.turn !== turn) continue
      await this.#drain(managed)
      const provider = this.#providers.get(managed.state.browserId)
      if (managed.state.lifecycle === 'temporary') {
        await provider?.close(this.#context(managed.automationSessionId, managed.workspaceRoot, AbortSignal.timeout(5_000)), managed.providerTab).catch(() => undefined)
        this.#tabs.delete(tabId)
      } else if (managed.state.lifecycle === 'claimed') {
        await provider?.release(this.#context(managed.automationSessionId, managed.workspaceRoot, AbortSignal.timeout(5_000)), managed.providerTab).catch(() => undefined)
        this.#tabs.delete(tabId)
      } else if (managed.state.lifecycle === 'handoff') {
        managed.turn = turn + 1
        managed.state.lifecycle = 'temporary'
      }
    }
    this.#selected.delete(sessionId)
    this.#bump(sessionId)
  }

  state(sessionId: string): BrowserStateSnapshot {
    return {
      sessionId, revision: this.#revisions.get(sessionId) ?? 0, browsers: this.descriptors(),
      tabs: [...this.#tabs.values()].filter(tab => tab.ownerSessionId === sessionId).map(tab => {
        const { snapshotImageDataUrl: _snapshotImageDataUrl, ...state } = tab.state
        return state
      }),
      ...(this.#selected.get(sessionId) === undefined ? {} : { selectedTabId: this.#selected.get(sessionId)! }),
    }
  }

  waitForRevision(sessionId: string, after: number, signal: BrowserSignalInput, timeoutMs: number = 25_000): Promise<number> {
    const current = this.#revisions.get(sessionId) ?? 0
    if (current !== after || signal.aborted) return Promise.resolve(current)
    return new Promise(resolve => {
      let waiters = this.#revisionWaiters.get(sessionId)
      if (waiters === undefined) { waiters = new Set(); this.#revisionWaiters.set(sessionId, waiters) }
      const cancellation = browserSignal(signal)
      let unsubscribe: () => void = () => undefined
      const finish = () => { clearTimeout(waiter.timer); unsubscribe(); waiters?.delete(waiter); if (waiters?.size === 0) this.#revisionWaiters.delete(sessionId); resolve(this.#revisions.get(sessionId) ?? 0) }
      const waiter: RevisionWaiter = { after, resolve: finish, timer: setTimeout(finish, Math.min(Math.max(timeoutMs, 1), 30_000)), abort: finish }
      waiter.timer.unref?.(); waiters.add(waiter); unsubscribe = cancellation.subscribe(waiter.abort)
    })
  }

  tab(sessionId: string, tabId: string): BrowserTabState { return { ...this.#owned(sessionId, tabId).state } }

  async persistScreenshot(sessionId: string, tabId: string, dataUrl: string): Promise<string> {
    this.#owned(sessionId, tabId)
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (match === null) throw new BrowserRuntimeError('BROWSER_UNAVAILABLE', 'Provider returned an invalid screenshot payload.')
    const artifactId = `browser-screenshot-${randomUUID()}`
    const root = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artifacts', 'browser-screenshots')
    await mkdir(root, { recursive: true, mode: 0o700 })
    await writeFile(join(root, `${artifactId}.png`), Buffer.from(match[1]!, 'base64'), { mode: 0o600 })
    return artifactId
  }

  async screenshotImage(sessionId: string, tabId: string): Promise<{ artifactId: string; dataUrl: string }> {
    const tab = this.#owned(sessionId, tabId).state
    if (tab.snapshotArtifactId === undefined) throw new BrowserRuntimeError('TAB_NOT_FOUND', `Browser tab ${tabId} has no screenshot artifact.`)
    const root = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'artifacts', 'browser-screenshots')
    const bytes = await readFile(join(root, `${tab.snapshotArtifactId}.png`))
    return { artifactId: tab.snapshotArtifactId, dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }
  }

  async dispose(): Promise<void> {
    for (const [tabId, managed] of [...this.#tabs]) await this.close(managed.ownerSessionId, tabId, AbortSignal.timeout(2_000)).catch(() => undefined)
    for (const provider of this.#providers.values()) await provider.dispose?.().catch(() => undefined)
    this.#providers.clear()
  }

  async clearProviderData(browserId: string): Promise<void> {
    const provider = this.#providers.get(browserId)
    if (provider === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Browser provider ${browserId} is not registered.`)
    if (provider.clearData === undefined) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${browserId} cannot clear profile data.`)
    const owners = new Set<string>()
    for (const [tabId, managed] of [...this.#tabs]) {
      if (managed.state.browserId !== browserId) continue
      await this.#drain(managed)
      await provider.close(this.#context(managed.automationSessionId, managed.workspaceRoot, AbortSignal.timeout(2_000)), managed.providerTab).catch(() => undefined)
      this.#tabs.delete(tabId); owners.add(managed.ownerSessionId)
    }
    await provider.clearData()
    for (const owner of owners) { this.#selected.delete(owner); this.#bump(owner) }
  }

  async manageProvider(browserId: string, action: 'install' | 'repair' | 'uninstall'): Promise<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }> {
    const provider = this.#providers.get(browserId)
    if (provider === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Browser provider ${browserId} is not registered.`)
    if (provider.manage === undefined) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${browserId} has no install or repair operation.`)
    const result = await provider.manage(action)
    for (const sessionId of this.#revisions.keys()) this.#bump(sessionId)
    return result
  }

  #normalizeSelection(request: BrowserSelectionRequest): Required<Pick<BrowserSelectionRequest, 'requirements'>> & Pick<BrowserSelectionRequest, 'preference' | 'url'> {
    const legacyCapabilities = (request.capabilities ?? []).map(capability => LEGACY_CAPABILITIES[capability] ?? capability)
    const requirements: BrowserRequirements = {
      ...(request.requirements ?? {}),
      ...(request.requirements?.capabilities === undefined && legacyCapabilities.length === 0 ? {} : { capabilities: [...(request.requirements?.capabilities ?? []), ...legacyCapabilities] }),
    }
    const preference = request.preference ?? (request.browserId === undefined ? undefined : { browserId: request.browserId })
    if (requirements.visibility === undefined && request.mode !== undefined && request.mode !== 'auto') requirements.visibility = request.mode === 'visible' ? 'live' : 'background'
    const hasProviderShapingRequirement = requirements.profile !== undefined || requirements.interaction !== undefined || (requirements.capabilities?.length ?? 0) > 0
    if (requirements.automation === undefined && requirements.visibility !== 'live' && preference === undefined && !hasProviderShapingRequirement) requirements.automation = this.#defaultAutomation
    return { requirements, ...(preference === undefined ? {} : { preference }), ...(request.url === undefined ? {} : { url: request.url }) }
  }

  #assess(descriptor: BrowserDescriptor, requirements: BrowserRequirements): BrowserRequirementAssessment {
    const missing: string[] = []
    if (descriptor.availability !== 'available') missing.push(descriptor.diagnostic ?? 'provider unavailable')
    if (requirements.automation === 'playwright' && !descriptor.capabilities.includes('automation.playwright')) missing.push('automation.playwright')
    if (requirements.automation === 'semantic' && !descriptor.capabilities.includes('core.semantic-actions')) missing.push('core.semantic-actions')
    if (requirements.visibility === 'live' && !descriptor.capabilities.includes('presentation.live')) missing.push('presentation.live')
    if (requirements.visibility === 'snapshot' && !descriptor.capabilities.includes('presentation.snapshot')) missing.push('presentation.snapshot')
    if (requirements.visibility === 'background' && descriptor.presentation.mode === 'live' && descriptor.providerKind !== 'managed') missing.push('background')
    if (requirements.interaction === 'manual-handoff' && !descriptor.capabilities.includes('interaction.manual-handoff')) missing.push('interaction.manual-handoff')
    if (requirements.interaction === 'interruptible' && !descriptor.capabilities.includes('interaction.interruptible')) missing.push('interaction.interruptible')
    if (requirements.profile !== undefined && descriptor.profile !== requirements.profile) missing.push(`profile.${requirements.profile}`)
    for (const capability of requirements.capabilities ?? []) if (!descriptor.capabilities.includes(capability)) missing.push(capability)
    return { browserId: descriptor.browserId, satisfied: missing.length === 0, missing: [...new Set(missing)] }
  }

  #score(descriptor: BrowserDescriptor, requirements: BrowserRequirements): number {
    if (requirements.visibility === 'live') {
      const exact = this.#visibleProviderOrder.indexOf(descriptor.browserId)
      const family = this.#visibleProviderOrder.indexOf(descriptor.family)
      return exact >= 0 ? exact : family >= 0 ? family : 100
    }
    if ((requirements.automation ?? this.#defaultAutomation) === 'playwright') {
      if (descriptor.family === this.#defaultEngine && descriptor.capabilities.includes('automation.playwright')) return 0
      if (descriptor.capabilities.includes('automation.playwright')) return 10
    }
    if (descriptor.providerKind === 'managed') return 20
    return 100
  }

  #nextAction(state: BrowserTabState): BrowserNextAction {
    if (state.controlState === 'presentation-required') return { kind: 'open-in-deepcreator', tool: 'open_in_deepcreator', input: { kind: 'browser-tab', tabId: state.tabId } }
    if (state.controlState === 'user-control') return { kind: 'manual-handoff', operation: 'handoffToUser', tabId: state.tabId }
    return { kind: 'ready' }
  }

  #owned(sessionId: string, tabId: string): ManagedTab {
    const managed = this.#tabs.get(tabId)
    if (managed === undefined) throw new BrowserRuntimeError('TAB_NOT_FOUND', `Browser tab ${tabId} does not exist in this process.`)
    if (managed.ownerSessionId !== sessionId) throw new BrowserRuntimeError('TAB_NOT_OWNED', `Browser tab ${tabId} is owned by another session.`)
    return managed
  }
  #context(automationSessionId: string, workspaceRoot: string, signal: BrowserSignalInput): BrowserProviderContext { return { automationSessionId, workspaceRoot, signal: browserSignal(signal) } }
  #syncState(managed: ManagedTab, tab: ProviderTab): void {
    Object.assign(managed.state, { url: tab.url, title: tab.title, loading: tab.loading, canGoBack: tab.canGoBack, canGoForward: tab.canGoForward })
    if (tab.surfaceId !== undefined) managed.state.surfaceId = tab.surfaceId
  }
  async #drain(managed: ManagedTab): Promise<void> {
    await Promise.race([managed.queue.catch(() => undefined), new Promise<void>(resolve => { const timer = setTimeout(resolve, 5_000); timer.unref?.() })])
  }
  #bump(sessionId: string): void {
    const revision = (this.#revisions.get(sessionId) ?? 0) + 1
    this.#revisions.set(sessionId, revision)
    for (const waiter of [...(this.#revisionWaiters.get(sessionId) ?? [])]) if (waiter.after !== revision) waiter.resolve(revision)
  }
}
