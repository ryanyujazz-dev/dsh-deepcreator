# Compatibility package instructions

This package is the single compatibility face between DeepCreator and the supported official Harness release.

- Record the supported npm version and exact upstream Git SHA in `compatibility.json`.
- Export public official types and narrowly scoped adapters only. Do not copy Runtime state, official UI components, or internal source files.
- Keep version checks centralized here; feature packages must not scatter official-version branches.
- Removed or incompatible official APIs fail explicitly. Do not preserve obsolete interfaces through silent shims.
- A version update requires `pnpm run verify:harness`, repository typechecking, affected tests, composed-config comparison, and a real Desktop smoke test.
