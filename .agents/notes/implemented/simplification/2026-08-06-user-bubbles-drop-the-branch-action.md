# User bubbles carry no branch action

- Date: 2026-08-06
- Lifecycle: implemented
- Class: simplification
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Branching from a user message is expressible (fork before the next turn), but the product decision is that branching belongs to answers, and steering bubbles must hand off to their durable twin without chrome noise.

## Decision
Like every user-style bubble, steering bubbles carry no branch action. The host waits for the durable `user/message` carrying the steering to join the mux flow before retiring the live one; when the client runtime accepts the live event it retires the first matching queued single-shot item before publishing the snapshot, and history events cannot hide later occurrences reusing the same `MessageId`. The bubble hands off without gap or duplicate, immediately restoring copy and clock from the durable node.

## Alternatives considered
Branch on user bubbles (rejected: the answer-side branch already covers forking a conversation) and hiding steering bubbles after handoff (rejected: the durable twin must appear immediately).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
