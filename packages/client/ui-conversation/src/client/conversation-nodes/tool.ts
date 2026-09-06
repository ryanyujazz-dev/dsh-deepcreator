import type { Context } from '@deepseek-ai/cordis'
import {
  type ConversationMatch,
  type ConversationNodeContext,
  type ConversationNodeDefinition,
  type RunningToolCall,
  type ToolCallBlock,
  type ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  isAppendSurfaceEvent,
} from '@deepseek-ai/dsh-session/surface'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools/presentation'

import { parseToolArgs, presentToolCall, presentToolResult } from '@ryanyujazz/dsh-client-compat'

import type {} from '@deepseek-ai/dsh-tools/types'
import type { ToolChatData } from '../contract/chat-nodes.ts'
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from './common.ts'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Root Tool lifecycle with recursively nested subcalls. */
    'tool-call': ToolChatData
  }
}

/**
 * The fork's render-intent views attached to the official record vocabulary.
 * 0.1.1 carried them on the wire; 0.1.2 dropped wire views for host-side tool
 * presenters no official client consumes yet, so the assembler derives the
 * same projections client-side (the compat replicas) and attaches them here.
 * Both stay optional: absent or null means the documented generic-card path.
 */
export type ViewRunningToolCall = RunningToolCall & {
  /** How the running call presents (terminal command head, pending diff, …). */
  readonly callView?: ToolCallView | null
}
export type ViewToolResultNode = ToolResultNode & {
  /** The settled result's presentation (terminal output, applied hunks, …). */
  readonly resultView?: ToolResultView | null
  /** The paired call's view, carried over so settled cards keep command/cwd. */
  readonly callView?: ToolCallView | null
}
export type ViewToolCallBlock = ViewRunningToolCall | ViewToolResultNode

const MAX_DEPTH = 256

interface ToolState {
  readonly root: ViewToolCallBlock
  readonly children: ReadonlyMap<string, readonly ViewToolCallBlock[]>
  readonly parents: ReadonlyMap<string, string>
}

interface ProjectedBlockCache {
  readonly children: readonly ViewToolCallBlock[]
  readonly interruptionSeq: number | undefined
  readonly interruptionTime: number | undefined
  readonly value: ViewToolCallBlock
}

const projectedBlocks = new WeakMap<ToolCallBlock, ProjectedBlockCache>()

function jsonArguments(value: unknown): string {
  return JSON.stringify(value)
}

function rootCall(match: ConversationMatch): ViewRunningToolCall {
  if (match.event.type !== 'tool/call') throw new Error('tool-call start requires tool/call')
  return {
    callId: String(match.event.data.callId),
    name: match.event.data.name,
    argsRaw: match.event.data.arguments,
    turn: match.event.data.turn,
    step: match.event.data.step,
    time: match.event.time,
    subCalls: [],
    callView: presentToolCall(match.event.data.name, parseToolArgs(match.event.data.arguments)) ?? null,
  }
}

function rootResult(match: ConversationMatch, previous?: ViewRunningToolCall): ViewToolResultNode | undefined {
  if (match.event.type !== 'tool/result') return undefined
  const block = match.event.data.message.content[0]
  const isError = block.isError === true
  // The harness persists the presentation payload on the model-facing
  // tool-result block; the event-level `meta` is the other alignment.
  const meta = (block as { meta?: unknown }).meta ?? match.event.data.meta
  // Without the call head (window truncation left the tool/call outside)
  // neither the tool name nor its parsed args exist, so the presenters stay
  // out and the generic path renders the raw result.
  const resultView = previous === undefined
    ? null
    : presentToolResult(previous.name, parseToolArgs(previous.argsRaw), {
      content: block.content,
      isError,
      meta,
    }) ?? null
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: String(match.event.data.message.source.callId),
    call: previous === undefined ? null : { name: previous.name, argsRaw: previous.argsRaw },
    callTime: previous?.time ?? null,
    content: block.content,
    isError,
    ...match.event.data.error === undefined ? {} : { error: match.event.data.error },
    meta,
    subCalls: [],
    callView: previous?.callView ?? null,
    resultView,
  }
}

interface DispatchData {
  readonly parentCallId: string
  readonly subCallId: string
  readonly name: string
  readonly arguments: unknown
  readonly isError?: boolean
  readonly content?: ToolResultNode['content']
}

function childCall(match: ConversationMatch, data: DispatchData): ViewRunningToolCall {
  return {
    callId: data.subCallId,
    name: data.name,
    argsRaw: jsonArguments(data.arguments),
    turn: locationTurn(match),
    step: locationStep(match),
    time: match.event.time,
    subCalls: [],
    callView: presentToolCall(data.name, data.arguments) ?? null,
  }
}

function childResult(match: ConversationMatch, data: DispatchData, previous?: ViewToolCallBlock): ViewToolResultNode {
  // PtcDispatchEventData carries content+isError only — no presentation meta —
  // so the child's view comes purely from the presenter's own derivation.
  const isError = data.isError === true
  const content = data.content ?? []
  return {
    kind: 'tool-result',
    seq: match.event.seq,
    time: match.event.time,
    callId: data.subCallId,
    call: { name: data.name, argsRaw: jsonArguments(data.arguments) },
    callTime: previous?.time ?? null,
    content,
    isError,
    subCalls: [],
    callView: previous?.callView ?? null,
    resultView: presentToolResult(data.name, data.arguments, { content, isError }) ?? null,
  }
}

function locationTurn(match: ConversationMatch): number {
  return match.location.kind === 'step' || match.location.kind === 'turn' ? match.location.turn.turn : 0
}

function locationStep(match: ConversationMatch): number {
  return match.location.kind === 'step' ? match.location.step.step : 0
}

function acceptsEdge(state: ToolState, parent: string, child: string): boolean {
  if (parent === child || state.parents.has(child)) return false
  let cursor: string | undefined = parent
  let parentDepth = 0
  const ancestors = new Set<string>()
  while (cursor !== undefined) {
    if (cursor === child || ancestors.has(cursor)) return false
    ancestors.add(cursor)
    parentDepth++
    cursor = state.parents.get(cursor)
  }
  const pending = [{ callId: child, depth: 1 }]
  const descendants = new Set<string>()
  let subtreeDepth = 0
  for (const candidate of pending) {
    if (descendants.has(candidate.callId)) return false
    descendants.add(candidate.callId)
    subtreeDepth = Math.max(subtreeDepth, candidate.depth)
    for (const nested of state.children.get(candidate.callId) ?? []) {
      pending.push({ callId: nested.callId, depth: candidate.depth + 1 })
    }
  }
  return parentDepth + subtreeDepth <= MAX_DEPTH
}

function updateDispatch(state: ToolState, match: ConversationMatch): ToolState {
  const event = match.event
  if (event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return state
  const data = event.data
  const parentCallId = String(data.parentCallId)
  const subCallId = String(data.subCallId)
  const siblings = state.children.get(parentCallId) ?? []
  const index = siblings.findIndex(candidate => candidate.callId === subCallId)
  if (event.type === 'tool/code-dispatch-start') {
    if (index >= 0 || !acceptsEdge(state, parentCallId, subCallId)) return state
    const children = new Map(state.children)
    children.set(parentCallId, [...siblings, childCall(match, data)])
    const parents = new Map(state.parents)
    parents.set(subCallId, parentCallId)
    return { ...state, children, parents }
  }
  if (index < 0 && !acceptsEdge(state, parentCallId, subCallId)) return state
  const previous = index < 0 ? undefined : siblings[index]
  const settled = childResult(match, data, previous)
  const children = new Map(state.children)
  children.set(parentCallId, index < 0
    ? [...siblings, settled]
    : siblings.map((child, at) => at === index ? settled : child))
  const parents = new Map(state.parents)
  if (index < 0) parents.set(subCallId, parentCallId)
  return { ...state, children, parents }
}

function projectBlock(
  block: ToolCallBlock,
  state: ToolState,
  interruptedAt: { seq: number; time: number } | undefined,
  visited = new Set<string>(),
  depth = 1,
): ViewToolCallBlock {
  if (visited.has(block.callId) || depth > MAX_DEPTH) return { ...block, subCalls: [] }
  const nextVisited = new Set(visited)
  nextVisited.add(block.callId)
  const children = (state.children.get(block.callId) ?? block.subCalls)
    .map(child => projectBlock(child, state, interruptedAt, nextVisited, depth + 1))
  const interruptionSeq = 'kind' in block ? undefined : interruptedAt?.seq
  const interruptionTime = 'kind' in block ? undefined : interruptedAt?.time
  const cached = projectedBlocks.get(block)
  if (cached !== undefined
    && cached.interruptionSeq === interruptionSeq
    && cached.interruptionTime === interruptionTime
    && sameReferences(cached.children, children)) {
    return cached.value
  }
  // The spread carries the attached views along; the synthetic interruption
  // result is intentionally viewless (an aborted call presents nothing).
  const projected: ViewToolCallBlock = 'kind' in block || interruptedAt === undefined
    ? sameReferences(block.subCalls, children) ? block : { ...block, subCalls: children }
    : {
      kind: 'tool-result',
      seq: interruptedAt.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedFollowup,
      time: interruptedAt.time,
      callId: block.callId,
      call: { name: block.name, argsRaw: block.argsRaw },
      callTime: block.time,
      content: [],
      isError: true,
      error: { name: 'Interrupted', code: 'interrupted' },
      subCalls: children,
    }
  projectedBlocks.set(block, { children, interruptionSeq, interruptionTime, value: projected })
  return projected
}

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function interruption(context: ConversationNodeContext<ToolState>): { seq: number; time: number } | undefined {
  const location = context.start?.location
  if (location?.kind === 'step' && location.step.status === 'closed') return location.step.end
  if ((location?.kind === 'step' || location?.kind === 'turn') && location.turn.status === 'closed') {
    return location.turn.end
  }
  return undefined
}

function fallbackState(context: ConversationNodeContext<ToolState>): ToolState | undefined {
  const match = context.matches.find(candidate => candidate.event.type === 'tool/result')
  const root = match === undefined ? undefined : rootResult(match)
  if (root === undefined) return undefined
  let state: ToolState = { root, children: new Map(), parents: new Map() }
  for (const candidate of context.matches) state = updateDispatch(state, candidate)
  return state
}

/** Root Tool lifecycle and nested Code Dispatch Definition. */
export const toolDefinition: ConversationNodeDefinition<ToolState> = {
  kind: 'tool-call',
  target: 'chat',
  match: (event) => {
    if (event.type === 'tool/call') return { id: String(event.data.callId), role: 'start' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    if (event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch') {
      const rootCallId: unknown = event.data.rootCallId
      return typeof rootCallId === 'string' && rootCallId !== ''
        ? { id: rootCallId, role: 'update' }
        : null
    }
    return null
  },
  start: (_context, match) => ({ root: rootCall(match), children: new Map(), parents: new Map() }),
  update: (context, match) => {
    if (match.event.type === 'tool/result') {
      const running = 'kind' in context.state.root ? undefined : context.state.root
      const result = rootResult(match, running)
      return result === undefined ? context.state : { ...context.state, root: result }
    }
    return updateDispatch(context.state, match)
  },
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state === undefined) return null
    const projected = projectBlock(state.root, state, interruption(context))
    const anchor = context.start?.event.seq
      ?? ('kind' in state.root ? state.root.seq : context.matches[0]?.event.seq ?? 0)
    return chatNode(context, 'tool-call', anchor, { root: projected } satisfies ToolChatData)
  },
}

/**
 * Register the root Tool lifecycle and nested-subcall contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerToolConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(toolDefinition)
}
