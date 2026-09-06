/** Build the canonical Chat slice consumed by Tool row and assembly tests. */
import {
  type ChatConversationViewNode,
  type ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  type ConversationNode,
  type RunningToolCall,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

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
