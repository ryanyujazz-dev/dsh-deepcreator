/** Busy-Enter preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Field carrying the user's fallback conversation-flow renderer. */
export const DEFAULT_RENDER_MODE_FIELD = 'defaultRenderMode'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Built-in render modes accepted by the durable preference. */
export const CONVERSATION_RENDER_MODES = ['normal', 'classic', 'think'] as const

/** A built-in conversation-flow renderer id. */
export type ConversationRenderMode = typeof CONVERSATION_RENDER_MODES[number]

/** New users start on the compact Classic conversation flow. */
export const DEFAULT_RENDER_MODE: ConversationRenderMode = 'classic'

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** Fallback renderer for sessions without a session-specific selection. */
  defaultRenderMode: ConversationRenderMode
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [DEFAULT_RENDER_MODE_FIELD]: z.union([...CONVERSATION_RENDER_MODES]).default(DEFAULT_RENDER_MODE),
})
