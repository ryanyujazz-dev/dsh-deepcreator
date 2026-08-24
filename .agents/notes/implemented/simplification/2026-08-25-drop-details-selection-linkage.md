# Agent Note: Drop the dead DetailsPanel selection linkage chain

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

The retired DetailsPanel left a complete, non-functional selection pipeline spanning ui-conversation and ui-tool: `ChatViewInjected.openDetails` was the sole caller of the chat store's `select` action, so `selection` was never written, `selectedCallId` was always `undefined`, and ui-tool's `selected={block.callId === selectedCallId}` was always false. The live inspection path (`inspectCall` → `setInspect`/`setView('trajectory')`) was separate and untouched. Dead companions: seven `details.*` locale keys (zh+en), HeroShell's retired workspace-picker modal CSS and stale `.body > .workspaceRow` selector, and the write-only `inbox-next-turn` conversation-node fold whose state nothing read (the `next-step` twin is load-bearing for steering classification).

## Decision

Removed the whole chain in one change: `openDetails` from `ChatRenderOwnerProps`/`ChatViewInjected` and the apply inject factory; `select` action + `selection` field + `SelectionTarget` type and re-export; `selectedCallId` plumbing through ChatRenderStandard/ExecFlowBody/ChatNodeSeat/slots and ui-tool's ToolCallTree (including the now-dead `selected`/`data-selected` on the ToolCall child); the seven locale keys; the HeroShell rules; and the `inbox-next-turn` definition/registration. `InboxTarget` stays the official two-member union (`@deepseek-ai/dsh-agent/types` widens `SessionEventMap` with it). A future Workbench inspector reintroduces its own selection write path rather than reviving this one.

## Alternatives considered

Wiring `openDetails` to some live consumer instead of deleting — rejected: the trajectory inspect handoff already covers tool inspection, so the chain protected nothing. Keeping the locale keys and modal CSS for a future picker — rejected as write-only surface.

## Verification

`rg "openDetails|selectedCallId|details\.title|modalInput|nextTurnInboxDefinition"` over packages/ (excluding lib/) returns no hits; ui-conversation 479 tests and ui-tool 215 tests pass via the root runner; full repository typecheck, `pnpm run test` (231 files / 2487 tests), and `pnpm run verify:harness` pass after the change. Owner: [ui-conversation README](../../../packages/client/ui-conversation/README.md).
