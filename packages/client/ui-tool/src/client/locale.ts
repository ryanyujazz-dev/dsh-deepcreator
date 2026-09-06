import type { Translate, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/** Locale namespace supplied by the conversation owner to Tool renderers. */
export const CONVERSATION_NS = 'conversation'

/**
 * Conversation keys the fork's Tool chrome adds to the shared dictionary. The
 * official 0.1.2 LocaleNamespaceMap declares the `conversation` seat with the
 * upstream key set and wins the declaration merge, so these runtime-served
 * keys ride a widened translate face where Tool chrome reads them.
 */
export type ToolConversationKey = 'command.failed' | 'row.revealChange' | 'execflow.inspect'

/** The injected conversation translate composed with the fork-owned keys. */
export type ToolTranslate = TranslateNS<'conversation'> & Translate<ToolConversationKey>
