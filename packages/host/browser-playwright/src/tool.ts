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
  return defineTool({
    name: 'playwright_run',
    description: 'Run JavaScript or TypeScript against the full Playwright Library API in a QuickJS isolate. Use this for multi-page, network, route, trace, video, download, request, CDP, or other advanced Playwright workflows. Code must be an async function receiving { playwright, browser, context, page, workspace, artifacts }. Await workspace.file(relativePath) for inputs, artifacts.output(kind, extension) for output files, and artifacts.directory(kind) for recordVideo/download/trace directories. controlled is default; opaque evaluation/CDP/launch requires per-call trusted approval. New Pages are returned as logical Browser tabIds.',
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
          if (OPAQUE_RISK_METHOD.test(request.method)) {
            const origin = request.summary.origin ?? 'unknown origin'
            await requestApproval(env, exec, agent, `${request.type}.${request.method} is opaque automation on ${origin} and may cause browser-visible or external side effects. Approve this specific opaque action only.`)
          }
      }
      const result = await provider.runScript(binding.context, binding.providerTab.providerTabId, args.code, mode, Math.min(Math.max(args.timeoutMs ?? 60_000, 1), 300_000), policy)
      const tabs = new Map<string, BrowserTabState>()
      tabs.set(targetTab.tabId, env.runtime.tab(sessionId, targetTab.tabId))
      for (const adopted of result.providerTabs) {
        const logical = env.runtime.adoptProviderTab({ sessionId, turn, workspaceRoot, browserId: `playwright-${adopted.engine}`, providerTab: adopted.tab })
        tabs.set(logical.tab.tabId, logical.tab)
      }
      return json({ value: result.value ?? null, tabs: [...tabs.values()].map(tab => ({ tabId: tab.tabId, url: tab.url, title: tab.title })), artifacts: result.artifacts, logs: result.logs, warnings: result.warnings })
    },
  })
}
