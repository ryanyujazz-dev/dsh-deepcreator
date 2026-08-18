# Search card: pre-cap totals, full-result copy, CodeBlock geometry

- Date: 2026-07-30
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
grep/glob results get capped for display; presenting capped output as complete, or copying only what is visible, misleads.

## Decision
Matches cap at the default 16 lines with the same split algorithm as TerminalBlock and never soft-wrap — long match lines or paths scroll horizontally. When the tool truncates, the banner summary carries the pre-cap totals (`显示 X / 共 N 处匹配 · K 个文件` for grep, `显示 X / 共 N 个路径` for glob), so the card never presents a capped result as complete. The copy control writes the whole structured result regardless of the cap or which groups are collapsed. Geometry mirrors CodeBlock/TerminalBlock.

## Alternatives considered
Ellipsis-only truncation markers (rejected: loses the totals) and copying the rendered slice (rejected: the copy is the audit artifact and must be complete).

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
