# Terminal card: one exit marker, replayed cursor column buffer

- Date: 2026-07-28
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Bash tool output needed a compact card without per-row status noise or mangled progress redraws.

## Decision
Exit status belongs to the whole call, so exactly one marker is rendered regardless of line count. Command text uses `white-space: pre` on a single ellipsized line, preserving repeated spaces, tabs, and continuation indents. ANSI escapes parse through the `anser` dependency into React spans; cursor movements replay into a per-line column buffer before inert controls are stripped, because carriage return and backspace only MOVE the cursor — `100%` + CR + `OK` alone must show `OK0%`, and spinner redraws must collapse.

## Alternatives considered
Per-row status marks (rejected: the view carries no per-line result) and stripping control codes without replay (rejected: loses overwrite semantics that terminals rely on).

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
