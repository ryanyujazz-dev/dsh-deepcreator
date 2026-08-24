# Agent Note: Prune dead public exports in ui-primitives

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

Three ui-primitives surfaces had no production consumer: the `useAnchoredMaxHeight` viewport-clamp hook (zero callers anywhere), `warmDiffHunkModels` (only its own memo warm-up test; `buildCachedDiffHunkModel` and siblings are live), and `extractMarkdownPlainText`'s `first-line`/`first-paragraph` mode surface (`MarkdownPlainTextMode`/`MarkdownPlainTextOptions`/`findFirstParagraph`) exercised only by tests — the sole production caller (ui-trajectory's preview) always projects the whole document.

## Decision

Deleted the hook file, its barrel export, and its README/README.zh sentences; deleted `warmDiffHunkModels` (the memo test now calls `buildCachedDiffHunkModel` directly); folded `extractMarkdownPlainText(markdown: string): string` to the single all-document projection, deleting the mode types and `findFirstParagraph` and their test cases.

## Alternatives considered

Keeping the hook/modes as public API convenience — rejected: the package's rule is one shared control only when feature packages need it; zero consumers means dead surface, and each item is trivially reintroduced at its point of need.

## Verification

`rg "useAnchoredMaxHeight|warmDiffHunkModels|findFirstParagraph|MarkdownPlainTextMode"` over packages/ returns no hits; ui-primitives 588 tests and ui-trajectory 101 tests pass via the root runner; full `pnpm run test` (231 files / 2487) and `pnpm run verify:harness` green. Owner: [ui-primitives README](../../../packages/client/ui-primitives/README.md).
