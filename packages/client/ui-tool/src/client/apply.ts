/** Register the Tool call tree and built-in atomic views. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import { EmbedToolCallTree, ToolCallTree } from './tool/ToolCallTree.tsx'
import { CONVERSATION_NS as NS } from './locale.ts'
import { askQuestionToolview } from './tool/toolviews/ask-question-row.tsx'
import { bashToolviewSample } from './tool/toolviews/bash-sample.tsx'
import { fileMutationToolview } from './tool/toolviews/file-mutation-row.tsx'
import { readToolview } from './tool/toolviews/read-row.tsx'
import { searchToolview } from './tool/toolviews/search-row.tsx'
import { todoToolview } from './tool/toolviews/todo-row.tsx'
import { webToolview } from './tool/toolviews/web-row.tsx'

/** Required service: the slot registry that owns both Tool render seats. */
export const inject = ['slots']

/** The Activity embed's toolview mirror seat (the tree's dispatch target there). */
export const EMBED_TOOLVIEW_SEAT = 'deepcreator.conversation.embed.toolview'

/**
 * Mount the whole-Tool renderers and built-in atomic Tool registrations.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  // The conversation flow's original seat (session-scoped standard kit).
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'tool-call',
    locale: NS,
    children: {
      'tool.call.toolview': { kind: 'keyed', scope: 'session' },
    },
  }, ToolCallTree))

  // The Activity embed's mirror seat: the same tree through the adapter,
  // dispatching to the embed's own toolview child seat.
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register({
    name: 'deepcreator.conversation.embed.node',
    key: 'tool-call',
    locale: NS,
    children: {
      'deepcreator.conversation.embed.toolview': { kind: 'keyed', scope: 'session' },
    },
  }, EmbedToolCallTree))

  ctx.plugin(bashToolviewSample)
  ctx.plugin(readToolview)
  ctx.plugin(fileMutationToolview)
  ctx.plugin(searchToolview)
  ctx.plugin(webToolview)
  ctx.plugin(todoToolview)
  ctx.plugin(askQuestionToolview)
}
