# Subagent UI instructions

This package owns subagent catalog, continuation routing, read-only composer presentation, and `@` reference UI.

- Official Session lineage and subagent services remain authoritative; do not infer or persist a separate hierarchy.
- Parent and child conversations interact through public Runtime and Slot contracts, not cross-package component imports.
- Keep subagent-only sessions hidden or reachable according to the official origin and lineage data consumed by the shared UI.
- Test continuation, missing descendants, active status, catalog disposal, and composer takeover behavior.
