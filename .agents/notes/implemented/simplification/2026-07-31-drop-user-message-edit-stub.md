# Drop the user-message edit stub

- Date: 2026-07-31
- Lifecycle: implemented
- Class: simplification
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Sent user messages carried a disabled edit affordance with no capability behind it.

## Decision
The stub is removed: user bubbles keep clock and copy, and branch exists only under assistant answers. Editing returns together with the capability behind it — a client mutation over a settled user message plus the host behavior for the turn that already consumed it.

## Alternatives considered
Keeping the disabled affordance (rejected: a permanently dead control documents nothing).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
