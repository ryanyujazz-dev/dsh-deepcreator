# The transcript scrollport reserves its scrollbar gutter unconditionally

- Date: 2026-08-04
- Lifecycle: implemented
- Class: bug-fix
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
When the transcript grew enough to scroll, the appearing scrollbar shifted the composer card sideways; overlay-mode views made it worse by changing the scroll container itself.

## Decision
The conversation scrollport (`data-conversation-scroll`) reserves its scrollbar gutter unconditionally, and a view opting into a composer overlay still leaves it a scroll container, so the input card keeps one horizontal position whether or not the transcript scrolls and whichever view tab is shown.

## Alternatives considered
`overflow: overlay`-style transient scrollbars (rejected: removed from Chromium) and per-view gutter compensation (rejected: every view would re-implement the same arithmetic).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
