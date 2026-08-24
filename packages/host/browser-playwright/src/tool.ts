import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type JsonValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import {
  BrowserRuntimeError, sanitizeBrowserModelValue, type BrowserRuntime, type BrowserTabState,
} from '@ryanyujazz/dsh-browser'
import { ManagedPlaywrightProvider } from './owner-client.ts'
import type { OwnerPolicyRequest } from './owner-protocol.ts'
import type { PlaywrightEngine } from './managed-provider.ts'
import type { PlaywrightScriptMode } from './script-isolate.ts'

const outputSchema = { type: 'json' } as const
const render = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }]
const HIGH_RISK_METHOD = /^(click|dblclick|check|uncheck|fill|type|press|pressSequentially|selectOption|setInputFiles|dispatchEvent|dragTo|submit|post|put|patch|delete|send)$/i
const NETWORK_METHOD = /^(goto|navigate|get|head|post|put|patch|delete|fetch|continue|fallback|fulfill)$/i
const OPAQUE_RISK_METHOD = /^(evaluate|evaluateHandle|evaluateAll|addInitScript|newCDPSession|connect|connectOverCDP|launchServer)$/i

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(sanitizeBrowserModelValue(value))) as JsonValue }
export function budgetPlaywrightOutput(value: unknown): JsonValue {
  const warnings: string[] = []
  const visit = (candidate: unknown, depth: number): unknown => {
    if (depth > 10) { warnings.push('Output depth exceeded 10 levels; deeper values were truncated.'); return '[TRUNCATED: depth > 10]' }
    if (typeof candidate === 'string') {
      if (candidate.length <= 20_000) return candidate
      warnings.push(`A string was truncated from ${candidate.length} to 20,000 characters.`)
      return `${candidate.slice(0, 20_000)}\n[TRUNCATED ${candidate.length - 20_000} characters; extract a smaller field or use browser_inspect document.]`
    }
    if (Array.isArray(candidate)) {
      if (candidate.length > 100) warnings.push(`An array was truncated from ${candidate.length} to 100 items.`)
      return candidate.slice(0, 100).map(item => visit(item, depth + 1))
    }
    if (candidate === null || typeof candidate !== 'object') return candidate
    return Object.fromEntries(Object.entries(candidate as Record<string, unknown>).map(([key, child]) => [key, visit(child, depth + 1)]))
  }
  const sanitized = sanitizeBrowserModelValue(value)
  const originalBytes = Buffer.byteLength(JSON.stringify(sanitized))
  const capped = visit(sanitized, 0) as Record<string, unknown>
  if (warnings.length > 0) capped.warnings = [...new Set([...(Array.isArray(capped.warnings) ? capped.warnings.map(String) : []), ...warnings])]
  const cappedJson = JSON.stringify(capped)
  if (Buffer.byteLength(cappedJson) <= 64 * 1024) return JSON.parse(cappedJson) as JsonValue
  const finalWarnings = [...new Set([...warnings, `Final JSON exceeded 64 KiB (original ${originalBytes} bytes). Return a smaller object or use browser_inspect document with pagination.`])]
  let previewLength = Math.min(cappedJson.length, 60_000)
  for (;;) {
    const result = json({ truncated: true, originalBytes, preview: cappedJson.slice(0, previewLength), warnings: finalWarnings })
    if (Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024 || previewLength === 0) return result
    previewLength = Math.max(0, Math.floor(previewLength * 0.8))
  }
}
function owner(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new BrowserRuntimeError('TAB_NOT_OWNED', 'playwright_run requires an owning root Agent session.')
  return exec.agent
}
function cwd(agent: Agent): string { return agent.session.header.cwd ?? process.cwd() }

export interface PlaywrightToolEnvironment {
  runtime: BrowserRuntime
  approval: ApprovalService
  turnOf(agent: Agent): number
}

async function requestApproval(env: PlaywrightToolEnvironment, exec: ToolRunContext, agent: Agent, reason: string): Promise<void> {
  const outcome = await env.approval.request({ agent, toolName: 'playwright_run', callId: exec.callId, signal: exec.signal, reason })
  if (outcome !== 'allowed-once') throw new BrowserRuntimeError('APPROVAL_DENIED', `Playwright action was not approved (${outcome}).`)
}

export function createPlaywrightRunTool(env: PlaywrightToolEnvironment): ToolDefinition {
  const crashState = new Map<string, { turn: number; consecutive: number }>()
  return defineTool({
    name: 'playwright_run',
    description: 'Run JavaScript or TypeScript against the full Playwright Library API in a QuickJS isolate. Use only for advanced multi-page, network, route, trace, video, download, request, or CDP workflows; ordinary research should use browser_inspect document. Code must be an async function receiving { playwright, browser, context, page, workspace, artifacts }. Every proxy method must be awaited, including Playwright methods that are synchronous in native JavaScript such as page.url() and response.status(). Await workspace.file(relativePath) for inputs, artifacts.output(kind, extension) for output files, and artifacts.directory(kind) for recordVideo/download/trace directories. controlled is default; trusted grants opaque API capability once for the whole invocation. Real external side effects still require separate approval. New Pages are returned as logical Browser tabIds. Do not mechanically retry an isolate crash.',
    parameters: {
      target: { type: 'object', required: true, additionalProperties: false, properties: {
        kind: { type: 'string', required: true, enum: ['tab', 'new'] }, tabId: { type: 'string' },
        engine: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] }, headless: { type: 'boolean' },
        profile: { type: 'string', enum: ['isolated', 'managed-persistent'] },
      } },
      code: { type: 'string', required: true }, mode: { type: 'string', enum: ['controlled', 'trusted'] }, timeoutMs: { type: 'integer' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const agent = owner(exec); const sessionId = String(agent.id); const turn = env.turnOf(agent); const workspaceRoot = cwd(agent)
      let crashes = crashState.get(sessionId)
      if (crashes === undefined || crashes.turn !== turn) {
        crashes = { turn, consecutive: 0 }; crashState.delete(sessionId); crashState.set(sessionId, crashes)
        while (crashState.size > 256) crashState.delete(crashState.keys().next().value as string)
      }
      if (crashes.consecutive >= 2) throw new BrowserRuntimeError('PLAYWRIGHT_ISOLATE_CRASHED', 'playwright_run is circuit-broken for this turn after two consecutive isolate crashes.', { suggestedNextStep: 'Use browser_inspect with action=document, or wait for the next turn before trying a substantially simpler script.' })
      const mode = (args.mode ?? 'controlled') as PlaywrightScriptMode
      if (mode === 'trusted') await requestApproval(env, exec, agent, 'Allow this playwright_run call to use opaque Playwright browser APIs (evaluate, raw CDP, BrowserType launch, or init scripts) inside the isolated script runtime. Node.js, arbitrary processes, unbrokered files, and credential export remain blocked.')

      let targetTab: BrowserTabState
      if (args.target.kind === 'new') {
        const engine = (args.target.engine ?? 'chromium') as PlaywrightEngine
        const created = await env.runtime.createTab({
          sessionId, turn, workspaceRoot,
          selection: { preference: { browserId: `playwright-${engine}` }, requirements: { automation: 'playwright', visibility: args.target.headless === false ? 'live' : 'background' } },
          tabRequirements: { profile: args.target.profile ?? 'isolated', visibility: args.target.headless === false ? 'live' : 'background' },
          signal: exec.signal,
        })
        targetTab = created.tab
      } else {
        if (args.target.tabId === undefined) throw new BrowserRuntimeError('TAB_NOT_FOUND', 'playwright_run target.kind="tab" requires target.tabId.')
        targetTab = env.runtime.tab(sessionId, args.target.tabId)
      }

      const binding = env.runtime.providerBinding(sessionId, targetTab.tabId, exec.signal, 'automation.playwright')
      if (!(binding.provider instanceof ManagedPlaywrightProvider)) throw new BrowserRuntimeError('CAPABILITY_UNSUPPORTED', `${targetTab.browserId} does not expose the managed Playwright owner.`)
      const provider = binding.provider
      const policy = async (request: OwnerPolicyRequest): Promise<void> => {
          if (NETWORK_METHOD.test(request.method)) for (const url of request.summary.urls) await env.runtime.networkPolicy.assertAllowed(url.replace(/^ws:/i, 'http:').replace(/^wss:/i, 'https:'))
          if (HIGH_RISK_METHOD.test(request.method)) {
            const origin = request.summary.origin ?? 'unknown origin'
            await requestApproval(env, exec, agent, `${request.type}.${request.method} may change external state on ${origin}. The action and any transmitted form/workspace data are approved for this invocation only.`)
          }
          if (mode !== 'trusted' && OPAQUE_RISK_METHOD.test(request.method)) {
            const origin = request.summary.origin ?? 'unknown origin'
            await requestApproval(env, exec, agent, `${request.type}.${request.method} is opaque automation on ${origin} and may cause browser-visible or external side effects. Approve this specific opaque action only.`)
          }
      }
      let result
      try {
        result = await provider.runScript(binding.context, binding.providerTab.providerTabId, args.code, mode, Math.min(Math.max(args.timeoutMs ?? 60_000, 1), 300_000), policy)
        crashes.consecutive = 0
      } catch (error) {
        if (error instanceof BrowserRuntimeError && error.code === 'PLAYWRIGHT_ISOLATE_CRASHED') crashes.consecutive++
        else crashes.consecutive = 0
        throw error
      }
      const tabs = new Map<string, BrowserTabState>()
      tabs.set(targetTab.tabId, env.runtime.tab(sessionId, targetTab.tabId))
      for (const adopted of result.providerTabs) {
        const logical = env.runtime.adoptProviderTab({ sessionId, turn, workspaceRoot, browserId: `playwright-${adopted.engine}`, providerTab: adopted.tab })
        tabs.set(logical.tab.tabId, logical.tab)
      }
      return budgetPlaywrightOutput({ value: result.value ?? null, tabs: [...tabs.values()].map(tab => ({ tabId: tab.tabId, url: tab.url, title: tab.title })), artifacts: result.artifacts, logs: result.logs, warnings: result.warnings })
    },
  })
}
