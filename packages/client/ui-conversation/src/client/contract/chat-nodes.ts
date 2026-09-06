/**
 * Chat node payload contracts. The official `dsh-client-ui-chat` package owns
 * the merge-extensible `ChatNodeDataMap` registry and every shipped payload;
 * this package contributes renderers for the shipped kinds (fork-customized
 * presentation, same node vocabulary) and re-exports the currency under the
 * historical fork import path.
 */
import {
  type RunningToolCall,
  type ToolCallBlock,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  AssistantChatData,
  ChatConversationViewNode,
  ChatNode,
  ChatNodeDataMap,
  ChatNodeKind,
  FinalAssistantChatData,
  ManualCompactionChatData,
  RetryChatData,
  ToolChatData,
  TurnProcessChatData,
  TurnTailChatData,
} from '@deepseek-ai/dsh-client-ui-chat/client'

export type {
  AssistantChatData,
  ChatConversationViewNode,
  ChatNode,
  ChatNodeDataMap,
  ChatNodeKind,
  FinalAssistantChatData,
  ManualCompactionChatData,
  RetryChatData,
  ToolChatData,
  TurnProcessChatData,
  TurnTailChatData,
}

// The official public merge surface (`index`) only flows into the contract
// registry through an `extends`; the two official kinds declared directly on
// the contract registry (system prompt, turn process) never appear on the
// public surface, leaving `ChatNodeKind` wider than the public map. Surface
// them here so the fork's payload map covers every official renderer kind.
declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Complete system prompt rendered for one model request. */
    'system-prompt': { readonly text: string }
    /** Turn-level disclosure controlling process rows before the finalized answer. */
    'turn-process': TurnProcessChatData
  }
}

/**
 * Tool-root lifecycle predicates, vendored from `dsh-client-ui-chat` (the
 * official package owns them, but a value import would cross the plugin
 * bundle boundary): a settled tool root carries its final result under
 * `kind`.
 */
export function isSettledTool(block: ToolCallBlock): block is Extract<ToolCallBlock, { kind: 'tool-result' }> {
  return 'kind' in block
}

/**
 * Test whether a Tool root is still running.
 * @param block - Tool root lifecycle value.
 * @returns whether the root lacks a final result.
 */
export function isRunningTool(block: ToolCallBlock): block is RunningToolCall {
  return !isSettledTool(block)
}
