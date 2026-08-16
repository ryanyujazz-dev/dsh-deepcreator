# dsh-deepcreator

Long-term plugin library for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).
Every plugin here is installable with `dsh plugin --profile <name> add <package>`, survives restarts, and
follows the family release rules of the official dsh project (one version line, one git tag per release,
prereleases publish under the `next` npm dist-tag).

## Plugins

| Plugin | Bundle (install unit) | Forked packages | What it does | Tested dsh range |
| --- | --- | --- | --- | --- |
| ExecFlow chat | `@ryanyujazz/dsh-execflow-chat` | `@ryanyujazz/dsh-client-ui-conversation`, `@ryanyujazz/dsh-client-ui-tool` | Native chat tab with a render-mode ring: 原生 / 经典 (execution-flow aggregation) / 思考 (inline thinking), picked from the tab-bar menu | `^0.1.0-rc.5` |

## Install

```sh
dsh plugin --profile web add @ryanyujazz/dsh-execflow-chat
```

Restart `dsh web`. Uninstall:

```sh
dsh plugin --profile web remove @ryanyujazz/dsh-execflow-chat
```

## Repository layout

- `packages/*` — forked dsh packages (each publishable under the `@ryanyujazz` scope).
- `bundles/*` — patch-layer bundles: the user-facing install unit that disables the stock rows a fork
  replaces and mounts the fork packages in their place.
- `scripts/release/` — family release machinery (see below).
- `VERSION` — the single family version; every package and bundle carries it.

## Adding a plugin

1. Add its fork packages under `packages/<name>` (import with `scripts/import-plugin.mjs`, or copy and
   rewrite the manifest: `@ryanyujazz` scope, `workspace:^` deps pinned to the tested dsh range).
2. Add its install bundle under `bundles/<name>`.
3. Add a row to the plugin table above with the tested dsh range.
4. Release: `pnpm run bump` (or `pnpm run bump --prerelease rc`), push, tag, `pnpm run publish`.

## Known limitations

- **pnpm install can fail on very large registry metadata** (react / react-dom packuments die with
  `UND_ERR_DESTROYED` / "unknown" on some networks while npm, curl, and node fetch succeed). Workaround:
  `npm install --no-save --no-package-lock tsdown lightningcss` in the repo root, then build. Retry a
  plain `pnpm install` later — the metadata fetch may recover and the lockfile picks the tools up.
- The fork packages build against the tested dsh contract (devDependencies pinned to the exact version);
  peerDependencies keep the wider range so newer dsh installs warn instead of hard-failing.


## Release

The family owns one version line (see `VERSION`). Releasing:

```sh
pnpm run bump            # bump VERSION + every manifest, commit
git push origin master
git tag plugins-v<version> <merge commit>
git push origin plugins-v<version>
pnpm run publish         # npm publish every package; prereleases go to the `next` dist-tag
```

A stable version takes the `latest` dist-tag; a prerelease (`-rc.*`, `-beta.*`) always publishes under
`next`, mirroring the official dsh publish rules.
