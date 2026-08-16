# Bundle instructions

Bundles are declarative Cordis composition packages. They select plugin rows; they do not implement feature behavior.

- Keep patches as top-level YAML lists with stable unique row ids.
- Disable only official UI rows that DeepCreator fully owns. Preserve official Host, Runtime, RPC, Session, and unchanged UI rows.
- Every inserted bare Client package must appear in the Bundle manifest dependencies and emit its declared browser entry.
- Preserve official shared Slot names. DeepCreator-only extension points use the `deepcreator.*` namespace.
- Do not solve Slot dependencies by row ordering or a central plugin list; use actual Slot declaration lifetimes.
- After a change, build affected packages, inspect `dsh --profile deepcreator --dump-config`, confirm one owner per replaced row, and perform a real browser smoke test.
