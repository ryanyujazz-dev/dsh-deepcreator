// Vendored from official deepseek-harness v0.1.1-rc.2
// (packages/client/runtime/src/client/sessions/conversation.ts) — the empty
// ConversationViewSnapshotStore used by fixtures and Sessions without
// registered views. The store type now lives in
// @deepseek-ai/dsh-client-ui-conversation.

import type { ConversationViewSnapshotStore } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Empty target store used by fixtures and Sessions without registered views. */
export const EMPTY_CONVERSATION_VIEWS: ConversationViewSnapshotStore = {
  get: () => undefined,
}
