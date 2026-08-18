# Search source list scrolls inside the card

- Date: 2026-08-03
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Long source lists inside search result cards previously stretched the transcript instead of scrolling in place.

## Decision
Together with the web result card note: the sources region scrolls vertically within the card past its cap; citation numbers stay stable through `<li value>`; caps and the empty-state contract follow the owning notes.

## Alternatives considered
Card growth with the list (rejected: one long search monopolizes the transcript).

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
