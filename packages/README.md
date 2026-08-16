# packages/

Forked dsh packages. Each package is publishable under the `@ryanyujazz` scope and carries the family
version (`../VERSION`).

Rules:

- Only fork a package when the feature cannot be delivered through the public composition seams (slots,
  services, patches). Forking means following upstream forever: merge `deepseek-ai/deepseek-harness`
  regularly and re-release the whole family with the same version.
- Keep the fork diff minimal and contract-additive: optional props and new slot keys only.
- Manifest rules: `@ryanyujazz/dsh-<name>` name, `workspace:^` dependency specifiers pinned to the tested
  dsh range (`^0.1.0-rc.5`), `repository` pointing at this library, `files` limited to built artifacts.
- Build: `tsc -p <package>` emits `lib/types`, then `pnpm --filter <package> bundle` (tsdown, via
  `scripts/tsdown.client.ts`) emits `lib/client.js` — the artifact the dsh web loader serves.

To import a new fork from a dsh checkout:

```sh
node scripts/import-plugin.mjs <dsh-checkout> <source-package-dir> <target-name>
```
