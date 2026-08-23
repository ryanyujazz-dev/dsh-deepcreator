import { randomUUID } from 'node:crypto'
import { createConnection, type Socket } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import {
  BrowserRuntimeError, browserSignal, type BrowserCommand, type BrowserCommandResult, type BrowserDescriptor, type BrowserErrorCode,
  type BrowserProvider, type BrowserProviderContext, type BrowserSignal, type BrowserTabRequest, type ProviderTab, type UserTabCandidate,
} from '@ryanyujazz/dsh-browser'

export const name = 'browser-iab-provider'
export const inject = ['browserRuntime']

export const BROWSER_RPC_ENV = { endpoint: 'DEEP_CREATOR_BROWSER_RPC_ENDPOINT', token: 'DEEP_CREATOR_BROWSER_RPC_TOKEN' } as const
export interface IabRpcRequest { id: string; token: string; method: string; params: unknown }
export interface IabRpcResponse { id: string; ok: boolean; result?: unknown; error?: { code: BrowserErrorCode; message: string } }
export interface IabRpcNotification { event: 'control-interrupted' | 'state-changed'; params: Record<string, unknown> }
type Pending = { resolve(value: unknown): void; reject(error: unknown): void }

export class IabRpcClient {
  readonly #pending = new Map<string, Pending>()
  readonly #listeners = new Set<(notification: IabRpcNotification) => void>()
  #socket: Socket | undefined
  #buffer = ''
  constructor(private readonly endpoint: string, private readonly token: string) {}

  onNotification(listener: (notification: IabRpcNotification) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  async call<T>(method: string, params: unknown, signal: BrowserSignal): Promise<T> {
    const socket = await this.#connect()
    if (signal.aborted) throw new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Browser command cancelled.')
    const id = randomUUID(); const request: IabRpcRequest = { id, token: this.token, method, params }
    return new Promise<T>((resolve, reject) => {
      const abort = () => { this.#pending.delete(id); reject(new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Browser command cancelled.')) }
      const unsubscribe = signal.subscribe(abort)
      this.#pending.set(id, {
        resolve(value) { unsubscribe(); resolve(value as T) },
        reject(error) { unsubscribe(); reject(error) },
      })
      socket.write(`${JSON.stringify(request)}\n`)
    })
  }
  dispose(): void { this.#socket?.destroy(); this.#socket = undefined; this.#failAll(new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'IAB RPC closed.')) }
  async #connect(): Promise<Socket> {
    if (this.#socket !== undefined && !this.#socket.destroyed) return this.#socket
    const socket = createConnection(this.endpoint)
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject) })
    socket.setEncoding('utf8'); socket.on('data', chunk => this.#data(String(chunk)))
    socket.on('error', error => this.#failAll(error))
    socket.on('close', () => { if (this.#socket === socket) this.#socket = undefined; this.#failAll(new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'IAB RPC disconnected.')) })
    this.#socket = socket; return socket
  }
  #data(chunk: string): void {
    this.#buffer += chunk
    for (;;) {
      const newline = this.#buffer.indexOf('\n'); if (newline < 0) break
      const line = this.#buffer.slice(0, newline); this.#buffer = this.#buffer.slice(newline + 1); if (line === '') continue
      const message = JSON.parse(line) as IabRpcResponse | IabRpcNotification
      if ('event' in message) { for (const listener of this.#listeners) listener(message); continue }
      const pending = this.#pending.get(message.id); if (pending === undefined) continue
      this.#pending.delete(message.id)
      if (message.ok) pending.resolve(message.result)
      else pending.reject(new BrowserRuntimeError(message.error?.code ?? 'PROVIDER_UNAVAILABLE', message.error?.message ?? 'IAB RPC failed.'))
    }
  }
  #failAll(error: unknown): void { for (const pending of this.#pending.values()) pending.reject(error); this.#pending.clear() }
}

export class IabBrowserProvider implements BrowserProvider {
  readonly #client: IabRpcClient | undefined
  constructor(onInterrupted: (surfaceId: string) => void, onStateChanged: (providerTabId: string) => void = () => {}) {
    const endpoint = process.env[BROWSER_RPC_ENV.endpoint]; const token = process.env[BROWSER_RPC_ENV.token]
    if (endpoint !== undefined && token !== undefined) {
      this.#client = new IabRpcClient(endpoint, token)
      this.#client.onNotification(notification => {
        if (notification.event === 'control-interrupted') { const value = notification.params.surfaceId; if (typeof value === 'string') onInterrupted(value) }
        else { const value = notification.params.providerTabId; if (typeof value === 'string') onStateChanged(value) }
      })
    }
  }
  descriptor(): BrowserDescriptor {
    return {
      browserId: 'iab', name: 'DeepCreator Built-in Browser', providerKind: 'in-app', family: 'chromium', profile: 'managed-persistent',
      capabilities: ['core.tabs', 'core.navigation', 'core.snapshot', 'core.screenshot', 'core.semantic-actions', 'core.wait', 'io.upload', 'io.download', 'interaction.manual-handoff', 'interaction.interruptible', 'interaction.secret-input-shielded', 'presentation.live', 'presentation.deepcreator-surface'],
      presentation: { owner: 'deepcreator', mode: 'live', requiredBeforeControl: true }, availability: this.#client === undefined ? 'unavailable' : 'available',
      ...(this.#client === undefined ? { diagnostic: 'Built-in Browser is available only in DeepCreator Desktop.' } : {}),
    }
  }
  async createTab(context: BrowserProviderContext, request: BrowserTabRequest): Promise<ProviderTab> { return this.#rpc().call('createTab', { automationSessionId: context.automationSessionId, request }, context.signal) }
  async listAgentTabs(context: BrowserProviderContext): Promise<ProviderTab[]> { return this.#rpc().call('listAgentTabs', { automationSessionId: context.automationSessionId }, context.signal) }
  async listUserTabs(context: BrowserProviderContext): Promise<UserTabCandidate[]> { return this.#rpc().call('listUserTabs', {}, context.signal) }
  async claimUserTab(context: BrowserProviderContext, candidate: UserTabCandidate): Promise<ProviderTab> { return this.#rpc().call('claimUserTab', { automationSessionId: context.automationSessionId, candidate }, context.signal) }
  async execute(context: BrowserProviderContext, tab: ProviderTab, command: BrowserCommand): Promise<BrowserCommandResult> { return this.#rpc().call('execute', { automationSessionId: context.automationSessionId, providerTabId: tab.providerTabId, command, workspaceRoot: context.workspaceRoot }, context.signal) }
  async show(_context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return tab }
  async handoffToUser(_context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return tab }
  async resumeControl(_context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return tab }
  async release(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.#rpc().call('release', { automationSessionId: context.automationSessionId, providerTabId: tab.providerTabId }, context.signal) }
  async close(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.#rpc().call('close', { automationSessionId: context.automationSessionId, providerTabId: tab.providerTabId }, context.signal) }
  async clearData(): Promise<void> { const signal = browserSignal(AbortSignal.timeout(10_000)); await this.#rpc().call('clearData', {}, signal) }
  async dispose(): Promise<void> { this.#client?.dispose() }
  #rpc(): IabRpcClient { if (this.#client === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Built-in Browser is unavailable outside Desktop.'); return this.#client }
}

export function apply(ctx: Context): void {
  const runtime = ctx.browserRuntime.providerRuntime()
  const provider = new IabBrowserProvider(surfaceId => runtime.interruptBySurface(surfaceId), providerTabId => { void runtime.refreshProviderTab('iab', providerTabId).catch(() => undefined) })
  ctx.effect(() => {
    const unregister = ctx.browserRuntime.registerBrowserProvider(provider)
    return () => { unregister(); void provider.dispose() }
  }, 'browser-iab-provider: register')
}
