import type { Context } from '@deepseek-ai/cordis'

/** The DSH client Context face. The old runtime re-exported it as ClientContext. */
export type ClientContext = Context

export type { SessionId } from '@deepseek-ai/dsh-session/types'

export type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

// Vendored capability shims for APIs the official 0.1.2 re-platform removed.
// Sources are tagged per file; these re-exports keep the presentation
// packages on their pre-migration import surface.
export {
  emptyAssistantBlock,
  isTokenDelta,
  toAssistantBlock,
  toAssistantBlocks,
} from './legacy/assistant'
export { contextForm, contextProvenance } from './legacy/context-provenance'
export type { ContextProvenanceView, ContextRole, KnownContextForm } from './legacy/context-provenance'
export { displayFailureMessage } from './legacy/display-failure'
export {
  PendingWait,
  type PendingInteraction,
  type PendingInteractionStatus,
  type PendingKind,
  type PendingPayloads,
  type PendingReceipt,
  type PendingResponseMessage,
  type PendingResponseResult,
} from './legacy/pending'
export { indexSubagentDescendants } from './legacy/subagent-lineage'
export type { SubagentDescendantSummary } from './legacy/subagent-lineage'
export { EMPTY_CONVERSATION_VIEWS } from './legacy/fixtures'
export {
  createSessionLeaseHub,
} from './observation'
export type {
  ObservationLeaseSessions,
  SessionLease,
  SessionLeaseHub,
  SessionLeaseSnapshot,
} from './observation'
export {
  parseToolArgs,
  presentToolCall,
  presentToolResult,
  type ToolResultProjection,
} from './presenters'
