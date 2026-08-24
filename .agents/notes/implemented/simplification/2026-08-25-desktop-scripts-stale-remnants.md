# Agent Note: Remove stale desktop and scripts remnants

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

Four leftovers from earlier repository eras: the dead `allowedBrowserPanelUrl` export duplicating `browser-views.ts`'s private `allowedProtocol` gate; `scripts/push-via-api.mjs` targeting the previous repository name `ryanyujazz-dev/dsh-plugins`; `scripts/import-plugin.mjs`, a one-shot fork-migration tool whose frozen package list omitted nine packages added since; and `scripts/platform.ts` seeding the official `@deepseek-ai/dsh-client-ui-primitives` into `PLATFORM_MODULES` although zero source files import that specifier.

## Decision

Deleted `allowedBrowserPanelUrl` and its test case (`allowedProtocol` remains the single navigation gate); deleted both one-off scripts and the import-plugin paragraph from packages/README.md; removed the official primitives entry from the module table. Follow-up in the same change: dropped the matching stale `@deepseek-ai/dsh-client-ui-primitives` devDependency from ui-conversation's manifest, which was the only remaining declaration of that specifier.

## Alternatives considered

Fixing import-plugin's package discovery instead of deleting — considered and declined: the migration workflow is complete, and the drifted list showed the tool was unmaintained. Restoring the platform seed entry if a future bundle imports the official primitives — re-add then; the build after removal stayed green with no inlining regression.

## Verification

`rg "allowedBrowserPanelUrl|push-via-api|import-plugin"` over apps/scripts/packages returns no hits; desktop typecheck + 33 tests pass; `pnpm run build` succeeds with the reduced externals table; full `pnpm run test` (231 files / 2487) and `pnpm run verify:harness` green. Owner: [packages README](../../../packages/README.md).
