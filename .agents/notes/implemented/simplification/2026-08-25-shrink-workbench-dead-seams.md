# Agent Note: Shrink dead seams in the Workbench package family

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

Five verified dead seams: `completeOuterResize` byte-identical to `setOuterWidth` with an ignored `_startWidth`; the `activateInstance` owner-props alias (every provider destructures `openInstance`); the `expand: 'all'` reveal parameter written at four sites but read by no receiver (the panel is expand-all by contract); the workbench v1 localStorage cleanup branch for a format nothing writes (v1 pair-axis snapshot intentionally retired); and `oddTrackWorkbenchWidth`'s `trackCount <= 1` arm, unreachable because the sole caller always passes ≥ 2.

## Decision

Removed all five: drag release calls `setOuterWidth(width)` with a boolean `dragging` flag replacing the dual-purpose `dragStart` ref; `activateInstance` left `WorkbenchPanelOwnerProps` and the owner object (plus the four test mocks across ui-workbench-tools/-activity/-artifact); `expand: 'all'` left the two review present sites, TurnChangeCard, and the `openParameters` default (`{scope:'unstaged'}`); `LEGACY_PERSIST_KEY` and its branch are gone while the corrupt/unknown-v2 removal stays; the width ratio is `trackCount === 2 ? 1/2 : 2/3`.

## Alternatives considered

Wiring `deleteSessionSnapshots`-style hygiene into the v1 branch instead of deleting — rejected: the key cannot be written by any current code path; cleanup of a format that never shipped in a composed release is noise.

## Verification

`rg "completeOuterResize|activateInstance|LEGACY_PERSIST_KEY|expand: 'all'"` over ui-workbench + ui-workbench-tools returns no hits; both packages typecheck and pass 40 + 87 tests (plus 68 across the activity/artifact suites whose mocks were trimmed); full `pnpm run test` (231 files / 2487) green. Owner: [ui-workbench README](../../../packages/client/ui-workbench/README.md).
