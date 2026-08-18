# Incremental AST rendering for streaming markdown

- Date: 2026-08-06
- Lifecycle: implemented
- Class: architecture
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
`MarkdownText` re-rendered the whole reply per streaming chunk; parse cost grew with reply length and starved the frame budget.

## Decision
While a reply streams, all but the trailing two blocks freeze as cached React elements and only the source tail behind them re-parses per chunk, so per-chunk work tracks the tail instead of the whole reply. File-mention openers render only on finalized output (streaming caches must not freeze possibly stale handlers); unresolved tokens stay non-interactive, and tokens inside anchors never become buttons because buttons cannot nest there. The renderer never guesses what looks like a path.

## Alternatives considered
Re-parsing the full document per chunk (the original behavior) and a virtualized block list (rejected: complexity without measurable gain at chat reply sizes).

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
