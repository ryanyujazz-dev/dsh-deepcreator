import type {
  ConversationSnapshot, ToolCallBlock,
} from '@deepseek-ai/dsh-client-runtime/client'
import { conversationContextKey } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

function toolNode(node: ReturnType<ConversationSnapshot['chat']['nodes']['get']>): ChatNode<'tool-call'> | undefined {
  return node?.kind === 'tool-call' ? node as ChatNode<'tool-call'> : undefined
}

/**
 * Read one root Tool lifecycle through the internal Chat Node index.
 * @param snapshot - current Conversation snapshot.
 * @param rootCallId - root call identity and Tool Context identity.
 * @returns root lifecycle when it is materialized in the current window.
 */
export function rootToolCall(
  snapshot: ConversationSnapshot,
  rootCallId: string,
): ToolCallBlock | undefined {
  return toolNode(snapshot.chat.nodes.get(conversationContextKey('tool-call', rootCallId)))?.data.root
}
