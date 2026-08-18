# Diff card: shared model, per-hunk caps, owning note for edit/write presentations

- Date: 2026-07-30
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Edit/write tool rows and the generic card fallback needed one shared diff presentation with documented caps, instead of each registration re-deciding them.

## Decision
The chat diff card renders through ui-primitives' shared line/word diff model with the owning caps recorded here: card-specific limits and fallback rules for the `diff` render intent live in this note (and the sibling terminal/read/search/web notes), while `ui-tool`'s README lists which built-in presentations consume them (shell, read, write/edit, grep/glob, web, todo, question, Code Dispatch) and `ui-skill` demonstrates a business-owned registration.

## Alternatives considered
Per-toolview ad-hoc diff rendering (rejected: divergent caps and fallbacks) and hosting the caps in each row component (rejected: the card owns its geometry contract).

Full behavior text: [packages/client/ui-tool/README.md](../../../packages/client/ui-tool/README.md).
