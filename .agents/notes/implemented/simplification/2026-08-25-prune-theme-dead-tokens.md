# Agent Note: Prune the dead shiki token block in ui-theme

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

`ui-theme/src/styles/shiki.css` declared `--shiki-foreground`, `--shiki-background`, and nine `--shiki-token-*` fallbacks under `:root` plus dark-theme overrides, with zero readers repo-wide. Actual token coloring flows through per-span inline `--shiki-${theme}` variables written by `ui-primitives/src/markdown/highlight.ts` (`codeToTokensWithThemes`) and consumed by the per-theme `body[data-code-theme=…]` rules; the invariant spec pins those theme blocks, not the dead declarations.

## Decision

Deleted both declaration blocks (each contained only `--shiki-*` lines) and the leading comment that documented them. Per-theme rules and the invariant contract untouched.

## Alternatives considered

Keeping the block as a "default Shiki theme" fallback — rejected: no rule or component ever read those names; each registered Shiki theme carries its own TextMate colors through the per-span variables.

## Verification

`rg "shiki-token|--shiki-foreground|--shiki-background"` over ui-theme returns no hits; ui-theme's 71 tests (including the shiki invariant spec) pass; full `pnpm run test` green. The follow-up sweep of the ~250 unread typography sub-tokens was scoped separately and tracked in its own note. Owner: [ui-theme README](../../../packages/client/ui-theme/README.md).
