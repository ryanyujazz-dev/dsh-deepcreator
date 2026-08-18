# Web result card: in-place source scroll, stable citation numbers, explicit empty state

- Date: 2026-07-30
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Search results with many sources stretched the card; `<ol>` implicit numbering broke when lists scrolled; a legal no-answer-no-source search rendered a blank list.

## Decision
The sources list scrolls vertically in place past its cap (`auto`) instead of growing the card. `<li value>` fixes each source's citation number, consecutive from 1, without relying on `<ol>` counting. A search that legally returns no answer and no sources shows an explicit empty-state note rather than a blank `<ol>` (the chat row never surfaces raw result content). A `fetch` shows a compact summary — the linked final URL and its HTTP status. Both mark a capped retrieval.

## Alternatives considered
Growing the card (rejected: blows the transcript rhythm) and hiding the card entirely on empty results (rejected: an explicit empty state distinguishes "nothing found" from "did not run").

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
