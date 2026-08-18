# Message fork actions require the completed-turn tail

- Date: 2026-08-02
- Lifecycle: implemented
- Class: bug-fix
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Forking from an arbitrary assistant message could fork from a state the host cannot reconstruct (mid-turn nodes, unfinished steps), producing broken children.

## Decision
The finalized content IconActions row (copy / clock / branch) ships only under the last content-text assistant of each ended turn; mid-turn narration, Think-only nodes, and every node of a turn still producing steps stay chrome-free. Branch stays disabled unless that message is also the last transcript node of a completed turn; when enabled it forks through that turn, increments the inherited title on the client, and opens the child. A fork or rename failure leaves the source selected.

## Alternatives considered
Forking from any assistant node (rejected: the host needs a durable turn end) and hiding the whole row until forkable (rejected: copy and clock remain useful on non-tail messages).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
