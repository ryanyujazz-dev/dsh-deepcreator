# Read card: file line numbers, showing N of M, head+tail collapse

- Date: 2026-07-30
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Windowed `read` results start mid-file; presenting them as line 1 misleads, and long reads blew up the transcript.

## Decision
A bold path (or presenter-provided title) banner with a copy control sits over content rows whose gutter carries the file's own line numbers — a windowed read offset past the start therefore begins at a number greater than 1. `totalLines` beyond the window draws a `showing N of M` note; past `maxLines` (default 16, the same split arithmetic as TerminalBlock) the body collapses to a head slice plus a tail slice behind an expand button. Highlighting runs through the same shiki path as `CodeBlock`.

## Alternatives considered
Card-relative numbering (rejected: defeats cross-referencing with the real file) and head-only truncation (rejected: the tail is usually the useful part of a read).

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
