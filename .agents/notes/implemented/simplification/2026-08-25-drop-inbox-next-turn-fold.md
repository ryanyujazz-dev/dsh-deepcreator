# Agent Note: Drop the write-only next-turn inbox fold

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day; folded into the details-linkage change)

## Context

ui-conversation registered `nextTurnInboxDefinition` (`inbox-next-turn`), folding durable `agent/inbox/spliced` events with `target === 'next-turn'` into a cumulative state nothing ever read — the definition published nothing, supplied no view builder, and `applySplice` maintains the claimed set only for `next-step`. The official runtime genuinely emits `next-turn` splices (`followup()`/`send()` paths), but the durable consumer for those messages is the Host's queue projection rendered by QueueDock, not a client fold. The twin `next-step` fold is load-bearing: `message.ts` reads its claimed set to classify a durable user message as a steering bubble.

## Decision

Deleted the definition and its registration, keeping `nextStepInboxDefinition`. Unmatched `next-turn` splice events now match no definition and contribute nothing — identical to their net effect before. `InboxTarget` remains the official two-member union from `@deepseek-ai/dsh-agent/types` (dropping it broke `SessionEventMap` narrowing), so the factory stays parameterized.

## Alternatives considered

Building the next-turn pre-admission steering UI the fold implied — rejected: no product owner; reintroduction is one factory call plus a reader.

## Verification

`rg "inbox-next-turn|nextTurnInboxDefinition"` over packages/ returns no hits; the conversation-node-definitions spec (19 tests) and the full ui-conversation suite (479 tests) pass; full `pnpm run test` green. Owner: [ui-conversation README](../../../packages/client/ui-conversation/README.md).
