# Thinking tail: moving summary that never fights page scroll

- Date: 2026-08-02
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Live reasoning throughput wanted a following view, but an auto-scrolling follower inside the page fights the user's own scrolling.

## Decision
Think rows stay collapsed by default and expose live reasoning throughput without expanding: while a reasoning block is the streaming tail, the summary switches from the settled first line to the latest non-empty line and its single-line scroller follows each delta to the inline end. Expanding the row removes the moving summary and leaves the full reasoning in ordinary page flow, so page reading never fights an internal follower; settlement restores the stable left-aligned first-line summary.

## Alternatives considered
Auto-expanding think rows while streaming (rejected: hijacks scroll) and a fixed-clamp tail view (rejected: hides the live edge that indicates progress).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
