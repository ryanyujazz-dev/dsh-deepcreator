# DeepCreator Web Bundle instructions

This package is the public installation unit for the complete DeepCreator browser presentation.

- `cordis.patch.yml` disables the official UI rows DeepCreator replaces and inserts every DeepCreator Client row with a stable `deepcreator-*` id.
- `package.json` must declare the complete dependency closure for all bare package names in the patch. Local development links belong to the managed profile, never to this published manifest.
- Keep official Host, Runtime, RPC, Session, settings services, and unchanged official UI rows active.
- Preserve shared official Slot protocols and use `deepcreator.*` only for product-owned child extension points.
- Adding or removing a row requires matching package dependencies, compatibility documentation, `dump-config` verification, and a real browser smoke test.
