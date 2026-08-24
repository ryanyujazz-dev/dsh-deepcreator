# Agent Note: Drop the review expansion localStorage persistence

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

`ui-workbench-tools/src/client/review-model.ts` carried a self-contained localStorage subsystem (`EXPANSION_KEY` `dsh.deepcreator.review.expansion.v1`, repo/path limits, `readExpansionMap`, exported `readExpandedPaths`/`writeExpandedPaths`) stranded by the demand-driven review data plane rework. The Review panel tracks expansion purely in memory (`expandedPaths` state + `expandedRef`), so nothing wrote the store and nothing read it back; the only consumers were the spec block pinning it.

## Decision

Deleted the six symbols and the `describe('expansion persistence')` block. No data migration: the v1 key was never written by any released composition, so no user carries it.

## Alternatives considered

Rewiring the panel to actually persist expansion — rejected as a product-behavior change; if cross-reload expansion memory is ever wanted it must be designed against the current controller, not resurrected from the orphan.

## Verification

`rg "readExpandedPaths|writeExpandedPaths|EXPANSION_KEY"` over the package returns no hits; ui-workbench-tools typecheck passes and its 87 tests pass via the root runner; full `pnpm run test` green. Owner: [ui-workbench README](../../../packages/client/ui-workbench/README.md).
