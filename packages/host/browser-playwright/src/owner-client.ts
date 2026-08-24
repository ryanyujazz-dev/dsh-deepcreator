import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  BrowserRuntimeError, type BrowserCommand, type BrowserCommandResult, type BrowserDescriptor, type BrowserProvider,
  type BrowserProviderContext, type BrowserTabRequest, type ProviderTab,
} from '@ryanyujazz/dsh-browser'
import { managedPlaywrightDescriptor, type PlaywrightEngine } from './managed-provider.ts'
import type { OwnerInput, OwnerOutput, OwnerPolicyRequest, OwnerRequest, OwnerScriptResult } from './owner-protocol.ts'
import type { PlaywrightScriptMode } from './script-isolate.ts'

interface Pending { resolve(value: unknown): void; reject(error: unknown): void; unsubscribe(): void; policy?: (request: OwnerPolicyRequest) => Promise<void> }

export class PlaywrightOwnerClient {
  readonly #pending = new Map<string, Pending>()
  #handle: SubprocessHandle | undefined
  #subprocess: SubprocessRuntime | undefined
  #lines: ReadlineInterface | undefined
  #ready: Promise<void> = Promise.resolve()
  #resolveReady: (() => void) | undefined
  #startupError: unknown
  #disposing = false
  constructor(private readonly onRestart: () => void = () => undefined) {}

  start(subprocess: SubprocessRuntime): void {
    if (this.#handle !== undefined) return
    this.#disposing = false
    this.#subprocess = subprocess
    const ownerEntry = fileURLToPath(new URL('./owner-entry.js', import.meta.url))
    const handle = subprocess.spawn({
      argv: [process.execPath, ownerEntry], cwd: process.cwd(), graceMs: 5_000,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
      env: {
        ...(process.env.DSH_HOME === undefined ? {} : { DSH_HOME: process.env.DSH_HOME }),
        ...(process.env.DEEP_CREATOR_BROWSER_EXECUTABLE === undefined ? {} : { DEEP_CREATOR_BROWSER_EXECUTABLE: process.env.DEEP_CREATOR_BROWSER_EXECUTABLE }),
        ...(process.env.HTTP_PROXY === undefined ? {} : { HTTP_PROXY: process.env.HTTP_PROXY }),
        ...(process.env.HTTPS_PROXY === undefined ? {} : { HTTPS_PROXY: process.env.HTTPS_PROXY }),
        ...(process.env.NO_PROXY === undefined ? {} : { NO_PROXY: process.env.NO_PROXY }),
        ...(process.env.http_proxy === undefined ? {} : { http_proxy: process.env.http_proxy }),
        ...(process.env.https_proxy === undefined ? {} : { https_proxy: process.env.https_proxy }),
        ...(process.env.no_proxy === undefined ? {} : { no_proxy: process.env.no_proxy }),
      },
    })
    if (handle.stdin === undefined || handle.stdout === undefined) throw new Error('Playwright Owner requires piped stdin/stdout.')
    this.#handle = handle
    this.#startupError = undefined
    this.#ready = new Promise(resolve => { this.#resolveReady = resolve })
    this.#lines = createInterface({ input: handle.stdout })
    this.#lines.on('line', line => this.#receive(line))
    void handle.done.then(
      outcome => this.#ownerExited(handle, new BrowserRuntimeError('PLAYWRIGHT_ISOLATE_CRASHED', `Playwright Owner exited (${String(outcome.exitCode)}, ${String(outcome.signal)}). It will restart once on the next call.`, { suggestedNextStep: 'Create a new Browser tab; tabs owned by the exited process are invalid.' })),
      error => this.#ownerExited(handle, error),
    )
  }

  descriptor(engine: PlaywrightEngine): BrowserDescriptor { return managedPlaywrightDescriptor(engine) }
  async installEngine(engine: PlaywrightEngine): Promise<void> {
    const subprocess = this.#subprocess
    if (subprocess === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Playwright subprocess service is unavailable.')
    const require = createRequire(import.meta.url); const cli = join(dirname(require.resolve('playwright-core/package.json')), 'cli.js')
    const handle = subprocess.spawn({ argv: [process.execPath, cli, 'install', engine], cwd: process.cwd(), graceMs: 10_000, stdio: { stdin: 'ignore', stdout: { maxBytes: 256_000 }, stderr: { maxBytes: 256_000 } } })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) {
      const diagnostic = handle.collected.stderr?.readFrom(0).text || handle.collected.stdout?.readFrom(0).text || `exit ${String(outcome.exitCode)}`
      throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Playwright ${engine} Browser Pack installation failed: ${diagnostic.slice(-4_000)}`)
    }
  }
  call<T>(method: string, params: Record<string, unknown>, signal: BrowserProviderContext['signal'], policy?: (request: OwnerPolicyRequest) => Promise<void>): Promise<T> {
    if (this.#handle === undefined && this.#subprocess !== undefined) this.start(this.#subprocess)
    if (this.#handle === undefined) return Promise.reject(new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Playwright Owner has not started.'))
    if (signal.aborted) return Promise.reject(new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Playwright Owner call cancelled.'))
    return this.#ready.then(() => {
      if (this.#startupError !== undefined) throw this.#startupError
      return new Promise<T>((resolve, reject) => {
      const id = randomUUID(); const unsubscribe = signal.subscribe(() => { this.#send({ kind: 'cancel', id }); this.#pending.delete(id); reject(new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Playwright Owner call cancelled.')) })
      this.#pending.set(id, { resolve: value => resolve(value as T), reject, unsubscribe, ...(policy === undefined ? {} : { policy }) })
      this.#send({ kind: 'request', id, method, params } satisfies OwnerRequest)
      })
    })
  }

  async dispose(): Promise<void> {
    this.#disposing = true
    this.#lines?.close(); this.#lines = undefined
    this.#handle?.terminate(); await this.#handle?.waitForExit(AbortSignal.timeout(6_000)).catch(() => undefined); this.#handle = undefined
    this.#subprocess = undefined
    this.#failAll(new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Playwright Owner disposed.'))
  }

  #receive(line: string): void {
    let message: OwnerOutput
    try { message = JSON.parse(line) as OwnerOutput } catch { return }
    if (message.kind === 'ready') { this.#resolveReady?.(); this.#resolveReady = undefined; return }
    const pending = this.#pending.get(message.kind === 'policy' ? message.requestId : message.id)
    if (pending === undefined) return
    if (message.kind === 'policy') {
      void (pending.policy?.(message) ?? Promise.resolve()).then(
        () => this.#send({ kind: 'policy-response', id: message.id, ok: true }),
        error => this.#send({ kind: 'policy-response', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
      return
    }
    this.#pending.delete(message.id); pending.unsubscribe()
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new BrowserRuntimeError(message.error?.code ?? 'PLAYWRIGHT_RUNTIME_ERROR', message.error?.message ?? 'Playwright Owner failed.', message.error?.details))
  }
  #send(message: OwnerInput): void { this.#handle?.stdin?.write(`${JSON.stringify(message)}\n`) }
  #ownerExited(handle: SubprocessHandle, error: unknown): void {
    if (this.#handle !== handle) return
    this.#lines?.close(); this.#lines = undefined; this.#handle = undefined
    if (!this.#disposing) this.onRestart()
    this.#failAll(error)
  }
  #failAll(error: unknown): void { this.#startupError = error; this.#resolveReady?.(); this.#resolveReady = undefined; for (const pending of this.#pending.values()) { pending.unsubscribe(); pending.reject(error) }; this.#pending.clear() }
}

export class ManagedPlaywrightProvider implements BrowserProvider {
  constructor(readonly engine: PlaywrightEngine, readonly owner: PlaywrightOwnerClient) {}
  descriptor(): BrowserDescriptor { return this.owner.descriptor(this.engine) }
  createTab(context: BrowserProviderContext, request: BrowserTabRequest): Promise<ProviderTab> { return this.owner.call('createTab', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot, request }, context.signal) }
  listAgentTabs(context: BrowserProviderContext): Promise<ProviderTab[]> { return this.owner.call('listAgentTabs', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot }, context.signal) }
  execute(context: BrowserProviderContext, tab: ProviderTab, command: BrowserCommand): Promise<BrowserCommandResult> { return this.owner.call('execute', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot, providerTabId: tab.providerTabId, command }, context.signal) }
  show(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { return this.owner.call('show', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot, providerTabId: tab.providerTabId }, context.signal) }
  async release(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.owner.call('release', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot, providerTabId: tab.providerTabId }, context.signal) }
  async close(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.owner.call('close', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot, providerTabId: tab.providerTabId }, context.signal) }
  async clearData(): Promise<void> { await this.owner.call('clearData', { engine: this.engine }, { aborted: false, subscribe: () => () => undefined }) }
  async manage(action: 'install' | 'repair' | 'uninstall'): Promise<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }> {
    if (action === 'uninstall') return { status: 'unavailable', diagnostic: 'Browser Pack removal is intentionally not automatic; remove the pinned Playwright cache from the Browser settings maintenance action.' }
    await this.owner.installEngine(this.engine)
    await this.owner.call('refreshEngine', { engine: this.engine }, { aborted: false, subscribe: () => () => undefined })
    const descriptor = this.descriptor()
    return { status: descriptor.availability === 'available' ? 'ready' : 'unavailable', ...(descriptor.diagnostic === undefined ? {} : { diagnostic: descriptor.diagnostic }) }
  }
  runScript(context: BrowserProviderContext, providerTabId: string, code: string, mode: PlaywrightScriptMode, timeoutMs: number, policy: (request: OwnerPolicyRequest) => Promise<void>): Promise<OwnerScriptResult> { return this.owner.call('runScript', { engine: this.engine, automationSessionId: context.automationSessionId, workspaceRoot: context.workspaceRoot, providerTabId, code, mode, timeoutMs }, context.signal, policy) }
}
