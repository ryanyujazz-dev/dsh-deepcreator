import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

import type { ChatNode } from '../contract/chat-nodes.ts'

function toolNode(node: ChatConversationViewNode | undefined): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

/**
 * Read one root Tool lifecycle through the internal Chat Node index. The
 * 0.1.2 node key is engine-minted (`chat:<kind>:<seq>`), so the lookup scans
 * the loaded window and matches on the lifecycle's call identity.
 * @param snapshot - current Chat snapshot.
 * @param rootCallId - root call identity and Tool Context identity.
 * @returns root lifecycle when it is materialized in the current window.
 */
export function rootToolCall(
  snapshot: ChatSnapshot,
  rootCallId: string,
): ToolCallBlock | undefined {
  for (const key of snapshot.order) {
    const node = toolNode(snapshot.nodes.get(key))
    if (node !== undefined && node.data.root.callId === rootCallId) return node.data.root
  }
  return undefined
}
