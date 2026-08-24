# Agent Note: Close the browser selection compat window and drop the unconsumed conformance harness

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

Two browser contract surfaces outlived their consumers. `BrowserSelectionRequest`'s top-level `browserId`/`capabilities` were one-release compat inputs backed by `LEGACY_CAPABILITIES`; every production caller used `preference`/`requirements`, and the legacy spellings appeared only in tests (DeepCreator ships host and client together, so no external caller can exist). `provider-conformance.ts` exported `runBrowserProviderConformance` with zero consumers; the architecture doc framed it as a future extension-Provider convenience.

## Decision

Removed the two top-level fields (keeping `mode`, which remains production-used), `LEGACY_CAPABILITIES`, and the `#normalizeSelection` fallbacks; rewrote the fifteen test call sites to `selection: { preference: { browserId: '…' } }` and reduced the compat-fallback case to a `mode`-only exercise of the same `CAPABILITY_UNSUPPORTED` outcome. Deleted `provider-conformance.ts`, its index re-export, and the architecture-doc paragraph. The `management.install` capability on the managed Playwright provider was audited alongside and is NOT dead — `ManagedPlaywrightProvider.manage()` implements install/refresh, so it stays.

## Alternatives considered

Moving the conformance harness to a test-time consumer — rejected: the three in-repo providers already have behavior suites; a harness with no external Provider ecosystem is speculative surface.

## Verification

`rg "LEGACY_CAPABILITIES|runBrowserProviderConformance|provider-conformance|selection: \{ browserId"` over the package and docs returns no hits; `@ryanyujazz/dsh-browser` typecheck passes and 56 tests pass; full `pnpm run test` (231 files / 2487) and `pnpm run verify:harness` green. Owner: [browser-use architecture](../../../docs/architecture/browser-use.md).
