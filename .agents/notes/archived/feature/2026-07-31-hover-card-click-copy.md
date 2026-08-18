# Hover card click-copy (retired surface)

- Date: 2026-07-31
- Lifecycle: archived
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
The hover-card atom once supported click-to-copy with host-verified feedback; the card surface carrying it was retired, and the record survives as the historical rationale for the copy interaction contract.

## Decision (historical)
`copyLabel`-prefixed value wrote through the in-package clipboard helper, and only after the host accepted the write did the label temporarily become `copiedLabel`. A non-collapsed text selection intersecting the card blocked pointer activation; success feedback kept the original card height and cleared when the card closed or after one second. The labels were props because this zero-cordis atom cannot read the application locale; omitting `copyText` preserved the read/select-only card.

## Alternatives considered
Immediate label swap without host confirmation (rejected: lies on clipboard rejection). Frozen: see archived/AGENTS.md.

Full behavior text: [packages/client/ui-primitives/README.md](../../../packages/client/ui-primitives/README.md).
