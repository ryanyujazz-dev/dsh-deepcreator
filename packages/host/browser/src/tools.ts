import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { defineTool, type JsonValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { BrowserRuntimeError } from './errors.ts'
import { sanitizeBrowserModelValue } from './model-sanitization.ts'
import type { BrowserRuntime } from './runtime.ts'
import type { BrowserCommand, BrowserLocator, BrowserNodeRef, BrowserSelectionRequest } from './types.ts'

const outputSchema = { type: 'json' } as const
function imageAttachment(value: unknown): ImageAttachmentRef | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = (value as { attachment?: unknown }).attachment
  if (candidate === null || typeof candidate !== 'object') return undefined
  const ref = candidate as Partial<ImageAttachmentRef>
  return typeof ref.attachmentId === 'string' && typeof ref.mediaType === 'string' && typeof ref.bytes === 'number'
    && typeof ref.width === 'number' && typeof ref.height === 'number' ? ref as ImageAttachmentRef : undefined
}
const render = (_args: unknown, value: unknown) => {
  const attachment = imageAttachment(value)
  const textValue = attachment === undefined || value === null || typeof value !== 'object'
    ? value
    : (() => {
        const { attachment: _attachment, tab, ...metadata } = value as Record<string, unknown>
        const page = tab !== null && typeof tab === 'object' ? tab as Record<string, unknown> : undefined
        return { ...metadata, attachmentId: String(attachment.attachmentId), mediaType: attachment.mediaType, width: attachment.width, height: attachment.height, ...(page === undefined ? {} : { url: page.url, title: page.title }) }
      })()
  const text = { type: 'text' as const, text: JSON.stringify(textValue) }
  return attachment === undefined ? [text] : [text, { type: 'image' as const, attachment }]
}
function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(sanitizeBrowserModelValue(value))) as JsonValue }
const locatorSchema = {
  type: 'object' as const, additionalProperties: false, properties: {
    kind: { type: 'string' as const, required: true as const, enum: ['node', 'role', 'text', 'label'] as const },
    snapshotId: { type: 'string' as const }, nodeRef: { type: 'string' as const }, role: { type: 'string' as const },
    name: { type: 'string' as const }, text: { type: 'string' as const }, exact: { type: 'boolean' as const }, label: { type: 'string' as const },
  },
}

export interface BrowserToolEnvironment {
  runtime: BrowserRuntime
  approval: ApprovalService
  turnOf(agent: Agent): number
}

function owner(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new BrowserRuntimeError('TAB_NOT_OWNED', 'Browser tools require an owning Agent session.')
  return exec.agent
}
function cwd(agent: Agent): string { return agent.session.header.cwd ?? process.cwd() }
function selection(args: {
  browserId?: string; family?: string; providerKind?: string; url?: string; capabilities?: string[]; mode?: string
  automation?: string; visibility?: string; interaction?: string; profile?: string
}): BrowserSelectionRequest {
  return {
    ...(args.url === undefined ? {} : { url: args.url }),
    ...((args.browserId ?? args.family ?? args.providerKind) === undefined ? {} : { preference: {
      ...(args.browserId === undefined ? {} : { browserId: args.browserId }),
      ...(args.family === undefined ? {} : { family: args.family as NonNullable<NonNullable<BrowserSelectionRequest['preference']>['family']> }),
      ...(args.providerKind === undefined ? {} : { providerKind: args.providerKind as NonNullable<NonNullable<BrowserSelectionRequest['preference']>['providerKind']> }),
    } }),
    ...((args.automation ?? args.visibility ?? args.interaction ?? args.profile ?? args.capabilities) === undefined ? {} : { requirements: {
      ...(args.automation === undefined ? {} : { automation: args.automation as 'semantic' | 'playwright' }),
      ...(args.visibility === undefined ? {} : { visibility: args.visibility as 'background' | 'snapshot' | 'live' }),
      ...(args.interaction === undefined ? {} : { interaction: args.interaction as 'agent-only' | 'manual-handoff' | 'interruptible' }),
      ...(args.profile === undefined ? {} : { profile: args.profile as 'isolated' | 'managed-persistent' | 'user' }),
      ...(args.capabilities === undefined ? {} : { capabilities: args.capabilities as NonNullable<NonNullable<BrowserSelectionRequest['requirements']>['capabilities']> }),
    } }),
    ...(args.mode === undefined ? {} : { mode: args.mode as NonNullable<BrowserSelectionRequest['mode']> }),
  }
}
function locator(raw: unknown): BrowserLocator | undefined {
  if (raw === undefined || raw === null || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (value.kind === 'node' && typeof value.snapshotId === 'string' && typeof value.nodeRef === 'string') return { kind: 'node', snapshotId: value.snapshotId, nodeRef: value.nodeRef }
  if (value.kind === 'role' && typeof value.role === 'string') return { kind: 'role', role: value.role, ...(typeof value.name === 'string' ? { name: value.name } : {}) }
  if (value.kind === 'text' && typeof value.text === 'string') return { kind: 'text', text: value.text, ...(typeof value.exact === 'boolean' ? { exact: value.exact } : {}) }
  if (value.kind === 'label' && typeof value.label === 'string') return { kind: 'label', label: value.label }
  throw new BrowserRuntimeError('STALE_SNAPSHOT', 'Locator fields do not match its kind.')
}
function locatorLabel(value: BrowserLocator | undefined): string {
  if (value === undefined) return 'page'
  if (value.kind === 'node') return value.nodeRef
  if (value.kind === 'role') return `${value.role} ${value.name ?? ''}`.trim()
  return value.kind === 'text' ? value.text : value.label
}
function sensitive(element: BrowserNodeRef | undefined): boolean {
  return element?.inputType === 'password' || element?.autocomplete === 'one-time-code' || element?.autocomplete?.startsWith('cc-') === true
}
function sideEffect(action: string, target: string, value: string | undefined, element: BrowserNodeRef | undefined): boolean {
  const semantics = [target, element?.role, element?.name, element?.inputType, element?.autocomplete].filter((item): item is string => item !== undefined).join(' ')
  if (action === 'upload' || action === 'drag') return true
  if (action === 'fill' || action === 'type' || action === 'select') {
    return ['email', 'tel'].includes(element?.inputType ?? '')
      || /(?:name|address|postal|country|organization|email|tel)/i.test(element?.autocomplete ?? '')
  }
  if (action === 'press' && value === 'Enter') return true
  return action === 'click' && (
    element?.inputType === 'submit'
    || element?.inputType === 'image'
    || /(submit|send|post|publish|buy|purchase|order|delete|remove|confirm|allow|permission|提交|发送|发布|购买|下单|删除|授权|确认)/i.test(semantics)
  )
}
async function approve(env: BrowserToolEnvironment, exec: ToolRunContext, tabId: string, action: string, target: string, dataCategory: string, value?: string, element?: BrowserNodeRef): Promise<void> {
  const agent = owner(exec)
  if (sensitive(element)) throw new BrowserRuntimeError('AUTH_REQUIRED', 'Password, OTP, and payment fields require a Browser Provider with shielded manual handoff.')
  if (!sideEffect(action, target, value, element)) return
  const tab = env.runtime.tab(String(agent.id), tabId)
  const origin = (() => { try { return new URL(tab.url).origin } catch { return tab.url } })()
  const outcome = await env.approval.request({ agent, toolName: 'browser_act', callId: exec.callId, signal: exec.signal, reason: `${action} on ${origin}, target ${JSON.stringify(target)}; data category: ${dataCategory}.` })
  if (outcome !== 'allowed-once') throw new BrowserRuntimeError('APPROVAL_DENIED', `Browser action was not approved (${outcome}).`)
}

async function approveControlReturn(env: BrowserToolEnvironment, exec: ToolRunContext, tabId: string, operation: 'resumeControl' | 'reacquire'): Promise<void> {
  const agent = owner(exec)
  const tab = env.runtime.tab(String(agent.id), tabId)
  const outcome = await env.approval.request({
    agent, toolName: 'browser_tabs', callId: exec.callId, signal: exec.signal,
    reason: `${operation} will return control of ${tab.browserId} tab ${tabId} to the Agent after user handoff or input interruption. Confirm that manual work is complete and Agent automation may continue.`,
  })
  if (outcome !== 'allowed-once') throw new BrowserRuntimeError('APPROVAL_DENIED', `Browser control return was not approved (${outcome}).`)
}

export function createBrowserToolDefinitions(env: BrowserToolEnvironment): ToolDefinition[] {
  const browserList = defineTool({
    name: 'browser_list', description: 'List Browser Providers or deterministically resolve one from automation, visibility, interaction, profile, family, and namespaced capability requirements. Explicit browserId/family is strict and never falls back.',
    parameters: {
      browserId: { type: 'string' }, family: { type: 'string', enum: ['chrome', 'chromium', 'firefox', 'webkit'] }, providerKind: { type: 'string', enum: ['managed', 'in-app', 'extension'] }, url: { type: 'string' },
      automation: { type: 'string', enum: ['semantic', 'playwright'] }, visibility: { type: 'string', enum: ['background', 'snapshot', 'live'] },
      interaction: { type: 'string', enum: ['agent-only', 'manual-handoff', 'interruptible'] }, profile: { type: 'string', enum: ['isolated', 'managed-persistent', 'user'] },
      capabilities: { type: 'array', items: { type: 'string' } },
      mode: { type: 'string', enum: ['visible', 'background', 'auto'] },
    }, output: { schema: outputSchema, render }, isConcurrencySafe: () => true,
    async execute(args) {
      const browsers = env.runtime.descriptors()
      if (args.browserId === undefined && args.family === undefined && args.providerKind === undefined && args.capabilities === undefined && args.mode === undefined && args.automation === undefined && args.visibility === undefined && args.interaction === undefined && args.profile === undefined) return json({ browsers })
      try { return json({ browsers, resolution: env.runtime.resolve(selection(args)) }) }
      catch (error) {
        if (error instanceof BrowserRuntimeError && error.code === 'CAPABILITY_UNSUPPORTED') return json({ browsers, resolution: null, error: { code: error.code, message: error.message, ...(error.details ?? {}) } })
        throw error
      }
    },
  })

  const browserTabs = defineTool({
    name: 'browser_tabs', description: 'Manage logical Browser tabs and turn-scoped leases. A new result includes nextAction: call open_in_deepcreator only when it says open-in-deepcreator; provider-owned visible tabs such as Chrome show themselves. Explicit Browser choices never fall back. User-visible tabs survive as deliverables; background temporary tabs close at turn end.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['list', 'new', 'listUser', 'claim', 'show', 'close', 'markDeliverable', 'markHandoff', 'handoffToUser', 'resumeControl', 'reacquire'] },
      tabId: { type: 'string' }, browserId: { type: 'string' }, family: { type: 'string', enum: ['chrome', 'chromium', 'firefox', 'webkit'] }, providerKind: { type: 'string', enum: ['managed', 'in-app', 'extension'] }, url: { type: 'string' },
      automation: { type: 'string', enum: ['semantic', 'playwright'] }, visibility: { type: 'string', enum: ['background', 'snapshot', 'live'] }, interaction: { type: 'string', enum: ['agent-only', 'manual-handoff', 'interruptible'] }, profile: { type: 'string', enum: ['isolated', 'managed-persistent', 'user'] },
      capabilities: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['visible', 'background', 'auto'] },
      candidate: { type: 'object', additionalProperties: false, properties: {
        providerTabId: { type: 'string', required: true }, title: { type: 'string', required: true }, url: { type: 'string', required: true }, revision: { type: 'integer', required: true },
        loading: { type: 'boolean' }, canGoBack: { type: 'boolean' }, canGoForward: { type: 'boolean' }, surfaceId: { type: 'string' },
      } },
    }, output: { schema: outputSchema, render },
    async execute(args, exec) {
      const agent = owner(exec); const sessionId = String(agent.id); const turn = env.turnOf(agent)
      if (args.operation === 'list') return json(env.runtime.state(sessionId))
      if (args.operation === 'new') return json(await env.runtime.createTab({ sessionId, turn, workspaceRoot: cwd(agent), selection: selection(args), ...(args.url === undefined ? {} : { url: args.url }), signal: exec.signal }))
      if (args.operation === 'listUser') {
        if (args.browserId === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'listUser requires browserId.')
        return json({ candidates: await env.runtime.listUserTabs(sessionId, args.browserId, cwd(agent), exec.signal) })
      }
      if (args.operation === 'claim') {
        if (args.browserId === undefined || args.candidate === undefined) throw new BrowserRuntimeError('TAB_NOT_FOUND', 'claim requires browserId and the complete candidate snapshot.')
        return json(await env.runtime.claimUserTab({ sessionId, turn, workspaceRoot: cwd(agent), browserId: args.browserId, candidate: { providerTabId: args.candidate.providerTabId, title: args.candidate.title, url: args.candidate.url, revision: args.candidate.revision, loading: args.candidate.loading ?? false, canGoBack: args.candidate.canGoBack ?? false, canGoForward: args.candidate.canGoForward ?? false, ...(args.candidate.surfaceId === undefined ? {} : { surfaceId: args.candidate.surfaceId }) }, signal: exec.signal }))
      }
      if (args.tabId === undefined) throw new BrowserRuntimeError('TAB_NOT_FOUND', `${args.operation} requires tabId.`)
      if (args.operation === 'close') { await env.runtime.close(sessionId, args.tabId, exec.signal); return json({ closed: true, tabId: args.tabId }) }
      if (args.operation === 'show') return json({ tab: await env.runtime.show(sessionId, args.tabId, exec.signal) })
      if (args.operation === 'handoffToUser') return json({ tab: await env.runtime.handoffToUser(sessionId, args.tabId, exec.signal) })
      if (args.operation === 'resumeControl') { await approveControlReturn(env, exec, args.tabId, 'resumeControl'); return json({ tab: await env.runtime.resumeControl(sessionId, args.tabId, exec.signal) }) }
      if (args.operation === 'reacquire') { await approveControlReturn(env, exec, args.tabId, 'reacquire'); return json({ tab: env.runtime.reacquire(sessionId, args.tabId) }) }
      return json({ tab: env.runtime.markLifecycle(sessionId, args.tabId, args.operation === 'markDeliverable' ? 'deliverable' : 'handoff') })
    },
  })

  const browserNavigate = defineTool({
    name: 'browser_navigate', description: 'Navigate an owned Browser tab. HTTP(S) and loopback development URLs are allowed; private networks, metadata services, file, data, and javascript URLs are blocked.',
    parameters: { tabId: { type: 'string', required: true }, action: { type: 'string', required: true, enum: ['goto', 'back', 'forward', 'reload'] }, url: { type: 'string' } },
    output: { schema: outputSchema, render },
    async execute(args, exec) { const agent = owner(exec); return json(await env.runtime.execute(String(agent.id), args.tabId, { kind: 'navigate', action: args.action, ...(args.url === undefined ? {} : { url: args.url }) }, exec.signal)) },
  })

  const browserInspect = defineTool({
    name: 'browser_inspect', description: 'Read a normalized document (preferred for research), URL/title, a versioned interactive snapshot, element metadata, or a screenshot. document defaults to 12,000 characters per page (20,000 maximum); continue with documentId and nextOffset. Screenshot results include a durable model-visible image attachment. nodeRef values are valid only with their snapshotId.',
    parameters: {
      tabId: { type: 'string', required: true }, action: { type: 'string', required: true, enum: ['document', 'snapshot', 'screenshot', 'url', 'title', 'elementInfo'] }, locator: locatorSchema,
      documentId: { type: 'string' }, offset: { type: 'integer' }, maxChars: { type: 'integer' },
    },
    output: { schema: outputSchema, render }, isConcurrencySafe: args => args.action !== 'screenshot',
    async execute(args, exec) {
      const agent = owner(exec); const loc = locator(args.locator)
      const result = await env.runtime.execute(String(agent.id), args.tabId, {
        kind: 'inspect', action: args.action, ...(loc === undefined ? {} : { locator: loc }),
        ...(args.documentId === undefined ? {} : { documentId: args.documentId }),
        ...(args.offset === undefined ? {} : { offset: Math.max(0, args.offset) }),
        ...(args.maxChars === undefined ? {} : { maxChars: Math.min(Math.max(args.maxChars, 1), 20_000) }),
      }, exec.signal)
      if (result.kind !== 'screenshot') return json(result)
      const attachment = env.runtime.tab(String(agent.id), args.tabId).snapshotAttachment
      if (attachment === undefined) throw new BrowserRuntimeError('BROWSER_UNAVAILABLE', 'Browser screenshot did not produce an attachment.')
      return json({ kind: 'screenshot', attachment, artifactId: String(attachment.attachmentId), tab: result.tab })
    },
  })

  const browserAct = defineTool({
    name: 'browser_act', description: 'Perform one semantic Browser action. Read a fresh snapshot first and pass snapshotId+nodeRef. Side effects request one-time approval; password, OTP, and payment entry requires shielded manual handoff in a live IAB or shared Chrome tab. Actions are never automatically replayed.',
    parameters: {
      tabId: { type: 'string', required: true }, action: { type: 'string', required: true, enum: ['click', 'fill', 'type', 'press', 'select', 'check', 'scroll', 'drag', 'upload'] },
      locator: locatorSchema, destination: locatorSchema, value: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, expected: { type: 'string', enum: ['none', 'navigation', 'download'] },
    }, output: { schema: outputSchema, render },
    async execute(args, exec) {
      const agent = owner(exec); const loc = locator(args.locator); const destination = locator(args.destination)
      let element: BrowserNodeRef | undefined
      if (loc !== undefined && args.action !== 'scroll') {
        const info = await env.runtime.execute(String(agent.id), args.tabId, { kind: 'inspect', action: 'elementInfo', locator: loc }, exec.signal)
        if (info.kind === 'elementInfo') element = info.element
      }
      if (args.action === 'drag' && destination === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', 'drag requires a semantic destination locator.')
      const sourceTarget = element?.name === undefined
        ? locatorLabel(loc)
        : `${locatorLabel(loc)} (${[element.role, element.name].filter(Boolean).join(' ')})`
      await approve(env, exec, args.tabId, args.action, destination === undefined ? sourceTarget : `${sourceTarget} to ${locatorLabel(destination)}`, args.action === 'upload' ? 'workspace file' : args.value === undefined ? 'none' : 'form value', args.value, element)
      const command: BrowserCommand = { kind: 'act', action: args.action, ...(loc === undefined ? {} : { locator: loc }), ...(destination === undefined ? {} : { destination }), ...(args.value === undefined ? {} : { value: args.value }), ...(args.files === undefined ? {} : { files: args.files }), ...(args.expected === undefined ? {} : { expected: args.expected }) }
      return json(await env.runtime.execute(String(agent.id), args.tabId, command, exec.signal))
    },
  })

  const browserWait = defineTool({
    name: 'browser_wait', description: 'Wait for a URL, load state, element visibility/hidden state, or dialog. Prefer this to fixed sleeps.',
    parameters: { tabId: { type: 'string', required: true }, condition: { type: 'string', required: true, enum: ['url', 'load', 'visible', 'hidden', 'dialog'] }, value: { type: 'string' }, locator: locatorSchema, timeoutMs: { type: 'integer' } },
    output: { schema: outputSchema, render }, isConcurrencySafe: () => true,
    async execute(args, exec) { const agent = owner(exec); const loc = locator(args.locator); return json(await env.runtime.execute(String(agent.id), args.tabId, { kind: 'wait', condition: args.condition, ...(args.value === undefined ? {} : { value: args.value }), ...(loc === undefined ? {} : { locator: loc }), ...(args.timeoutMs === undefined ? {} : { timeoutMs: Math.min(Math.max(args.timeoutMs, 1), 120_000) }) }, exec.signal)) },
  })

  return [browserList, browserTabs, browserNavigate, browserInspect, browserAct, browserWait]
}
