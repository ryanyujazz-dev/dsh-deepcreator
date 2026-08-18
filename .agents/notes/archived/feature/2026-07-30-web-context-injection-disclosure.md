# Context injection disclosure row (superseded)

- Date: 2026-07-30
- Lifecycle: archived
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
The original compact disclosure for context-injection messages; superseded by the context source projection record (2026-08-04), which kept the DisclosureRow geometry and the 141px scrolling cap while adding the role/producer header.

## Decision (historical)
Context injections render as a default-collapsed disclosure row; the expanded body follows its content height up to a 141px scrolling cap and synthesizes no tool state or summary.

## Alternatives considered
Full inline rendering of injected context (rejected even then: drowns the flow). Frozen: see archived/AGENTS.md.

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
