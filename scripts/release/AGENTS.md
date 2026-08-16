# Release script instructions

This directory owns the shared version family, npm publication, tags, and release preparation.

- Discover manifests from the current workspace layout: `packages/client/*` and `packages/bundle/*`. Do not retain assumptions about removed `bundles/` or flat `packages/*` layouts.
- Publish only intentional public `@ryanyujazz` packages; Desktop remains private until an installer release process exists.
- Rewrite all family manifests and the lockfile together, then verify package tarball contents before publication.
- Prereleases use a non-`latest` dist-tag. Never overwrite a published version.
- Require a clean worktree, successful build, typecheck, tests, Harness verification, and explicit npm authentication before publishing.
- Use annotated release notes and tags that identify the exact commit; never include local links, credentials, profiles, or generated user data.
