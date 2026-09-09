import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

interface SystemMessageState {
  readonly seq: number
}

/**
 * Claim durable system-prompt surface events for Chat without rendering them.
 * Trajectory owns their inspectable presentation; claiming the Chat target here
 * prevents the generic unknown-surface fallback from exposing prompt internals.
 */
export const systemMessageDefinition: ConversationNodeDefinition<SystemMessageState> = {
  kind: 'system-message',
  target: 'chat',
  match: event => event.type === 'system/message'
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => ({ seq: match.event.seq }),
  update: context => context.state,
  buildViewNode: () => null,
}

/** Register the non-visual Chat claimant for system prompt events. */
export function registerSystemMessageConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(systemMessageDefinition)
}
