# Web subagent conversations with a FIFO inbox

- Date: 2026-07-27
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
A child subagent session needs its own conversation surface, but must never receive host context or call model-facing tools itself.

## Decision
While the exact parent is alive, a continuable child keeps the normal input chrome: every follow-up routes through `subagent.prompt` into the child's FIFO inbox, and an independent Stop routes through `subagent.interrupt`. When the parent is gone the child becomes read-only with a replacement prompt. The package never receives host context and never calls a model-facing tool.

## Alternatives considered
Disabling the child composer entirely while it runs (rejected: follow-ups are the core continuable-interrupt use case) and a shared parent/child transcript (rejected: the child session owns its own log).

Full behavior text: [packages/client/ui-subagent/README.md](../../../packages/client/ui-subagent/README.md).
