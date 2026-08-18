# Continuable subagent interrupt

- Date: 2026-08-06
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Stopping a running child used to end the conversation surface; the interrupt should stop the work while keeping the channel continuable.

## Decision
While a child runs, input and Send stay usable because every follow-up joins the child's FIFO inbox through `subagent.prompt`; an independent Stop routes through `subagent.interrupt` and leaves the conversation continuable afterwards.

## Alternatives considered
A terminal stop that retires the child surface (rejected: follow-ups after a stop are the primary workflow).

Full behavior text: [packages/client/ui-subagent/README.md](../../../packages/client/ui-subagent/README.md).
