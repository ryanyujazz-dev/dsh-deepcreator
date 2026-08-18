# Target-owned Conversation node Definitions stay independent

- Date: 2026-08-09
- Lifecycle: implemented
- Class: architecture
- Status: rebuilt 2026-08-18 — referenced by jscpd ignore markers in ui-trajectory's definition files but never committed in the fork; decision restored from the referencing comments and package structure.

## Context
Every `ConversationViewBuilder` target (chat, trajectory, artifacts) folds its own snapshot from the same event stream through `ConversationNodeDefinition` state machines. ui-trajectory's message/assistant/tool definitions structurally resemble ui-conversation's node definitions, and copy-detection flags the shared event-handling shapes.

## Decision
Each view target owns its Definitions outright: ui-trajectory keeps its own event state machines (with the `MAX_DEPTH` guard and its Inbox/Steering identities) instead of importing ui-conversation's, even where the logic overlaps. The overlap is bounded boilerplate (start/update guards over the same official events), while the folded state, depth handling, and evolution cadence differ per target — coupling them would make every view change a cross-package negotiation. The `jscpd:ignore-start` markers in the three definition files point here as the acknowledged record; the same reasoning keeps the per-package assistant-block predicates (hasVisibleContent & siblings) duplicated rather than shared, mirroring how the official packages themselves each carry private copies.

## Alternatives considered
A shared definitions package (rejected: turns one view's evolution into a cross-package contract) and importing ui-conversation's definitions (rejected: chat-specific state shapes leak into every other target).

Full behavior text: [packages/client/ui-trajectory/README.md](../../../packages/client/ui-trajectory/README.md).
