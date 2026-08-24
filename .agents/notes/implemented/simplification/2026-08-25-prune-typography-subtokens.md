# Agent Note: Prune the unread typography sub-token layer

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (follow-up to the shiki-token prune, shipped the same day)

## Context

The Figma-exported font sheet (`ui-theme/src/styles/gradient-shadow-text.css`) declared every typography composite as a font shorthand plus five mechanical sub-token expansions (`-font-family`/`-font-size`/`-font-style`/`-font-weight`/`-line-height`), and the `TRANSCRIPT_TOKENS` writer republished a subset per reading size. Two-channel liveness analysis (independent `rg` scripts plus a delegated audit, both using a fallback-aware `var\(\s*NAME\s*[,)]` matcher — an exact `var(NAME)` matcher undercounts because real readers write `var(--name, 14px)`) found 145 sub-tokens with zero production readers and no dynamic `--dsw-font-${…}` construction anywhere. Six sub-tokens ARE live and were the analysis's counterexample to the original "all sub-tokens dead" premise: `markdown-base-font-size`/`-line-height` (streaming tool drafts and row geometry, pinned by UI_STYLE_GUIDE), `markdown-code-block-small-font-size`/`-line-height` (activity compact details), `markdown-code-font-family`, plus the published-and-read `sidebar-font-size`/`-line-height`/`sidebar-row-height`.

## Decision

Deleted the 141 CSS declaration lines and the 21 dead `TRANSCRIPT_TOKENS` keys (7 names × 3 sizes) so the runtime no longer publishes unread variables to `<body>`. Kept every composite, every base token, and the six read sub-tokens; UI_STYLE_GUIDE.md needed no edit because it documents only the surviving names. The dead-composite bonus findings (e.g. `base-16`, `xl-24`, `markdown-small*`, `markdown-table*`, `xxxs-11`) were left in place as out-of-scope for this sweep.

## Alternatives considered

Keeping the full expansion as a design-token API — rejected: nothing consumed it, and the guide mandates consuming composites and the six named sub-tokens, which all survive. Reintroducing a sub-token is a one-line declaration at its point of need.

## Verification

Deletion was blocked unless every name had zero non-declaration, non-test occurrences repo-wide; after the change, spot checks confirm the deleted names are gone (including regenerated lib/) while all six KEEP names still have live `var()` readers. The transcript-sync spec now pins the code size through the live `--dsw-font-markdown-code` composite. Full gates green: `pnpm run typecheck`, `pnpm run test` (231 files / 2487 tests), `pnpm run build`, `pnpm run verify:harness`. Owner: [ui-theme README](../../../packages/client/ui-theme/README.md).
