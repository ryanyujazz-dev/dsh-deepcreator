import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { BrowserNetworkPolicy, BrowserRuntimeError, browserSignal, type BrowserProviderContext, type ProviderTab } from '@ryanyujazz/dsh-browser'
import { OwnedPlaywrightProvider, type PlaywrightEngine } from './managed-provider.ts'
import type { OwnerInput, OwnerOutput, OwnerRequest, OwnerScriptResult } from './owner-protocol.ts'
import { PlaywrightScriptIsolate, type PlaywrightScriptMode } from './script-isolate.ts'

const network = new BrowserNetworkPolicy()
const providers = new Map<PlaywrightEngine, OwnedPlaywrightProvider>(['chromium', 'firefox', 'webkit'].map(engine => [engine as PlaywrightEngine, new OwnedPlaywrightProvider(engine as PlaywrightEngine, network)]))
const controllers = new Map<string, AbortController>()
const policies = new Map<string, { resolve(): void; reject(error: unknown): void }>()
function output(message: OwnerOutput): void { process.stdout.write(`${JSON.stringify(message)}\n`) }
function provider(engine: unknown): OwnedPlaywrightProvider { const value = providers.get(engine as PlaywrightEngine); if (value === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Unknown Playwright engine ${String(engine)}.`); return value }
function urls(value: unknown): string[] { if (typeof value === 'string' && /^(?:https?|wss?):/i.test(value)) return [value]; if (Array.isArray(value)) return value.flatMap(urls); if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(urls); return [] }
async function approve(requestId: string, type: string, method: string, summary: { urls: string[]; origin?: string }): Promise<void> {
  const id = randomUUID(); output({ kind: 'policy', id, requestId, type, method, summary })
  return new Promise<void>((resolve, reject) => policies.set(id, { resolve, reject }))
}
function context(params: Record<string, unknown>, signal: AbortSignal): BrowserProviderContext { return { automationSessionId: String(params.automationSessionId ?? ''), workspaceRoot: String(params.workspaceRoot ?? process.cwd()), signal: browserSignal(signal) } }

async function dispatch(request: OwnerRequest, signal: AbortSignal): Promise<unknown> {
  const params = request.params; const owned = provider(params.engine); const ctx = context(params, signal)
  if (request.method === 'createTab') return owned.createTab(ctx, params.request as never)
  if (request.method === 'listAgentTabs') return owned.listAgentTabs(ctx)
  if (request.method === 'execute') return owned.execute(ctx, { providerTabId: String(params.providerTabId) } as ProviderTab, params.command as never)
  if (request.method === 'show') return owned.show(ctx, { providerTabId: String(params.providerTabId) } as ProviderTab)
  if (request.method === 'release') return owned.release(ctx, { providerTabId: String(params.providerTabId) } as ProviderTab)
  if (request.method === 'close') return owned.close(ctx, { providerTabId: String(params.providerTabId) } as ProviderTab)
  if (request.method === 'clearData') return owned.clearData()
  if (request.method === 'refreshEngine') { await owned.dispose(); providers.set(params.engine as PlaywrightEngine, new OwnedPlaywrightProvider(params.engine as PlaywrightEngine, network)); return null }
  if (request.method === 'runScript') {
    const selectedEngine = params.engine as PlaywrightEngine; const target = owned.scriptEnvironment(String(params.providerTabId)); const adopted = new Map<string, { engine: PlaywrightEngine; tab: ProviderTab }>()
    const isolate = new PlaywrightScriptIsolate({ ...target, engine: selectedEngine, workspaceRoot: ctx.workspaceRoot, observe: async (value, invocation) => { const observedEngine = /\((chromium|firefox|webkit)\)$/.exec(invocation.type)?.[1] as PlaywrightEngine | undefined; const engine = observedEngine ?? selectedEngine; for (const tab of await provider(engine).observeScriptValue(value)) adopted.set(`${engine}:${tab.providerTabId}`, { engine, tab }) } }, {
      mode: params.mode as PlaywrightScriptMode,
      beforeCall: async (type, method, args) => {
        const found = urls(args)
        for (const raw of found) await network.assertAllowed(raw.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:'))
        const pageUrl = owned.page(String(params.providerTabId)).url(); let origin: string | undefined
        try { origin = new URL(pageUrl).origin } catch { /* no origin */ }
        await approve(request.id, type, method, { urls: found, ...(origin === undefined ? {} : { origin }) })
      },
    })
    const result = await isolate.run(String(params.code), Number(params.timeoutMs), signal)
    return { ...result, providerTabs: [...adopted.values()] } satisfies OwnerScriptResult
  }
  throw new BrowserRuntimeError('PLAYWRIGHT_RUNTIME_ERROR', `Unknown Playwright Owner method ${request.method}.`)
}

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  let message: OwnerInput
  try { message = JSON.parse(line) as OwnerInput } catch { return }
  if (message.kind === 'cancel') { controllers.get(message.id)?.abort(); return }
  if (message.kind === 'policy-response') { const pending = policies.get(message.id); if (pending !== undefined) { policies.delete(message.id); if (message.ok) pending.resolve(); else pending.reject(new BrowserRuntimeError('APPROVAL_DENIED', message.error ?? 'Playwright policy denied.')) }; return }
  const controller = new AbortController(); controllers.set(message.id, controller)
  void dispatch(message, controller.signal).then(
    result => output({ kind: 'response', id: message.id, ok: true, result }),
    error => output({ kind: 'response', id: message.id, ok: false, error: { code: error instanceof BrowserRuntimeError ? error.code : 'PLAYWRIGHT_RUNTIME_ERROR', message: error instanceof Error ? error.message : String(error) } }),
  ).finally(() => controllers.delete(message.id))
})
lines.on('close', () => { void Promise.all([...providers.values()].map(item => item.dispose())).finally(() => process.exit(0)) })
output({ kind: 'ready', descriptors: [...providers.values()].map(item => item.descriptor()) })
