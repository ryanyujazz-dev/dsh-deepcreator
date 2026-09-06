/** Build the canonical Chat slice consumed by Tool row and assembly tests. */
import {
  type ChatConversationViewNode,
  type ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  type ConversationNode,
  type RunningToolCall,
  type ToolCallBlock,
  type ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type SessionEventLikeEntry,
} from '@deepseek-ai/dsh-api-session-controller/client'

/**
 * Project the canonical Tool fixtures into the 0.1.2 durable event feed —
 * Conversation assembly materializes the same Tool nodes from these events:
 * one `tool/call` per call (running or settled), `tool/code-dispatch(-start)`
 * pairs for nested sub-calls, and an append-surface `tool/result` settling
 * each settled root call.
 */
export function toolCallEvents(
  settled: readonly ToolResultNode[] = [],
  running: readonly RunningToolCall[] = [],
): SessionEventLikeEntry[] {
  const entries: SessionEventLikeEntry[] = []
  let seq = 0
  const emit = (type: string, time: number, data: Record<string, unknown>, surfaceOp?: string): void => {
    seq += 1
    entries.push({
      type: 'event',
      event: { type, seq, time, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) },
    } as unknown as SessionEventLikeEntry)
  }
  const dispatches = (rootCallId: string, subCalls: readonly ToolCallBlock[]): void => {
    for (const sub of subCalls) {
      if ('kind' in sub) {
        emit('tool/code-dispatch', sub.time, {
          rootCallId, parentCallId: rootCallId, subCallId: sub.callId,
          name: sub.call?.name ?? '', arguments: JSON.parse(sub.call?.argsRaw ?? '{}'),
          isError: sub.isError, content: sub.content,
        })
      }
      else {
        emit('tool/code-dispatch-start', sub.time, {
          rootCallId, parentCallId: rootCallId, subCallId: sub.callId,
          name: sub.name, arguments: JSON.parse(sub.argsRaw ?? '{}'),
        })
      }
    }
  }
  for (const node of settled) {
    emit('tool/call', node.callTime ?? node.time, {
      turn: 1, step: 1, callId: node.callId,
      name: node.call?.name ?? '', arguments: node.call?.argsRaw ?? '{}',
    })
    dispatches(node.callId, node.subCalls)
    emit('tool/result', node.time, {
      turn: 1, step: 1,
      message: {
        id: `m:${node.callId}`, role: 'user',
        content: [{ type: 'tool-result', toolCallId: node.callId, content: node.content, isError: node.isError }],
        source: { kind: 'tool', callId: node.callId },
      },
      ...('error' in node && node.error !== undefined ? { error: node.error } : {}),
    }, 'append')
  }
  for (const call of running) {
    emit('tool/call', call.time, {
      turn: call.turn, step: call.step, callId: call.callId,
      name: call.name, arguments: call.argsRaw,
    })
    dispatches(call.callId, call.subCalls)
  }
  return entries
}

export function toolChatSnapshot(
  settled: readonly ConversationNode[] = [],
  running: readonly RunningToolCall[] = [],
): ChatSnapshot {
  const roots = [...settled.filter(node => node.kind === 'tool-result'), ...running]
  const nodes: ChatConversationViewNode[] = roots.map(root => ({
    key: `tool:${root.callId}`,
    kind: 'tool-call',
    id: root.callId,
    target: 'chat',
    anchorSeq: 'kind' in root ? root.seq : Number.MAX_SAFE_INTEGER,
    location: { kind: 'session' },
    visibility: 'visible',
    data: { root },
  }))
  const byKey = new Map(nodes.map(node => [node.key, node]))
  const empty: readonly string[] = []
  return {
    order: nodes.map(node => node.key),
    nodes: {
      get: key => byKey.get(key),
      values: () => nodes,
    },
    locations: {
      getTurn: () => empty,
      getStep: () => empty,
    },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: {
      nodes: settled,
      runningCalls: running,
      partial: null,
      turnTimings: new Map(),
      turnEnds: new Map(),
    },
  }
}
