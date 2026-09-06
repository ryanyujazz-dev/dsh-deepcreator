// Vendored from official deepseek-harness v0.1.1-rc.2
// (packages/client/runtime/src/client/sessions/conversation.ts,
//  packages/client/runtime/src/client/sessions/partial.ts,
//  packages/llm/llm/src/message.ts) — the 0.1.2 re-platform removed the
// runtime package without a replacement for these client-side classifiers.
// `AssistantBlock` itself now lives in @deepseek-ai/dsh-client-ui-conversation.

import type { ContentBlock, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * core ContentBlock[] -> AssistantBlock[] (classifier shared by finalized messages and partial block-end).
 * @param content - core content blocks verbatim.
 * @returns UI-classified blocks in source order.
 */
export function toAssistantBlocks(content: readonly ContentBlock[]): AssistantBlock[] {
  return content.map(toAssistantBlock)
}

/**
 * Classify one block (ToolCallBlock fields are id/arguments, mapped to callId/argsRaw).
 * @param block - one core content block.
 * @returns the UI classification.
 */
export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'image': return { kind: 'image', attachment: block.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
    default: return { kind: 'other', block }
  }
}

/**
 * Create the empty client projection for one streamed Assistant block kind.
 * @param blockType - wire block kind.
 * @returns empty projected block ready to receive deltas.
 */
export function emptyAssistantBlock(blockType: string): AssistantBlock {
  switch (blockType) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'tool-call': return { kind: 'tool-call', callId: '', name: '', argsRaw: '' }
    default: return { kind: 'other', block: null }
  }
}

/**
 * Whether a stream chunk carries visible model output (the first-token
 * boundary shared by client step timing and the whole-log sessionStats
 * projection). Empty deltas (heartbeats, empty tool-call frames) do not count
 * as a first token.
 * @param chunk - the stream chunk to test.
 * @returns true when the chunk contains a non-empty text/reasoning/tool delta.
 */
export function isTokenDelta(chunk: StreamChunk): boolean {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.text !== ''
    case 'tool-call-delta':
      return chunk.argumentsDelta !== '' || chunk.name !== undefined
    default:
      return false
  }
}
