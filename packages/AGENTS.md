# Package instructions

Packages are the published DeepCreator plugin family. Client features live under `client/`; installable Cordis composition lives under `bundle/`.

- Package names use the `@ryanyujazz/` scope and share the repository version family.
- Use `workspace:^` between DeepCreator packages and the pinned supported version for official Harness dependencies.
- Import another package through its public package export, never through its `src/` or `lib/` path.
- Keep ESM manifests, explicit exports, publishable `files`, public repository metadata, strict TypeScript, and browser/Host entry points consistent.
- Generated `lib/` output is never edited or committed as source. Package tests must pass from a clean build.
- A package owns one coherent feature. Move a reusable primitive into `ui-primitives`; do not create a generic dumping-ground package.
- Public Slot names, settings namespaces, event keys, and durable values are compatibility obligations and must be documented with their owner.
