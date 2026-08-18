# Context source projection and steer marks

- Date: 2026-08-04
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Context injections and cross-session recalls needed compact flow rows whose origin is readable without expanding; steering messages needed a signal without decoration.

## Decision
Context renders as a default-collapsed disclosure whose header first shows the runtime-projected role — injection as `上下文注入`, recall as `跨会话召回` — followed by the producer name the projection reads from durable sources, so skill directories, workspace instruction files, and recalled sessions are distinguishable unexpanded; without a producer name only the role shows. The shared `DisclosureRow` primitive keeps the geometry of other compact rows; the expanded body follows content height up to a 141px scrolling cap and synthesizes no tool state or summary. Steered (mid-turn) bubbles keep plain user-bubble presentation — their mid-turn position in the transcript is the only steering signal.

## Alternatives considered
Always-expanded context blocks (rejected: drowns the flow) and decorated steering bubbles (rejected: position already carries the signal).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
