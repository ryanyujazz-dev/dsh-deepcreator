# Read card frontend registration and caps

- Date: 2026-07-30
- Lifecycle: implemented
- Class: feature
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
The `read` render intent needed its chat-row registration documented alongside the shared ReadBlock caps.

## Decision
ui-tool registers the read presentation for its built-in read tools; card-specific limits and fallback rules stay in the owning ReadBlock note while this record pins the registration surface (keyed toolview plus generic fallback) that consumes it.

## Alternatives considered
Owning the caps inside the registration (rejected: ReadBlock owns its geometry contract and ui-primitives' note already records it).

Full behavior text: [packages/client/ui-tool/README.md](../../../packages/client/ui-tool/README.md).
