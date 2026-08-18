# Themed scrollbars: standard properties or pseudo-elements, never both

- Date: 2026-07-28
- Lifecycle: implemented
- Class: bug-fix
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Declaring `scrollbar-width`/`scrollbar-color` (standard) and `::-webkit-scrollbar*` (pseudo-elements) together was expected to give every engine a themed scrollbar with a hover state.

## Decision
Any non-`auto` value of either standard property makes Chromium and Safari drop ALL `::-webkit-scrollbar*` rules on that element — including `::-webkit-scrollbar-thumb:hover` — so unconditional dual declaration left `--dsh-scrollbar-thumb-hover` unrendered in every engine. Firefox therefore takes the standard properties and WebKit-based engines take the pseudo-elements; the hover token only ever renders through the pseudo-element path.

## Alternatives considered
Dual declaration everywhere (measured broken; see the computed-value walk in the owning README) and JS feature detection (rejected: the property/value split is fully expressible in CSS).

Full behavior text: [packages/client/ui-theme/README.md](../../../packages/client/ui-theme/README.md).
