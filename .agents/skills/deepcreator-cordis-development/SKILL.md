---
name: deepcreator-cordis-development
description: Develop, refactor, debug, or validate DeepCreator's Cordis Client plugins, Slot composition, deepcreator-web Bundle, managed deepcreator profile, official Harness compatibility layer, and Electron Desktop integration. Use for changes under packages/client, packages/bundle, apps/desktop, profile or verification scripts, UI architecture, settings or render-mode synchronization, official Harness upgrades, and plugin load or mount failures in dsh-deepcreator.
---

# Developing DeepCreator on Cordis

Use this workflow to keep DeepCreator independently upgradeable while preserving the official Harness Runtime and Cordis composition model.

## Load repository authority

1. Read the repository-root `AGENTS.md` completely.
2. Read every nested `AGENTS.md` from the root to the target directory.
3. Read `docs/architecture/deepcreator.md` for ownership changes.
4. Read `UI_STYLE_GUIDE.md` for any visible UI, typography, menu, control, or interaction change.
5. Read [references/repository-map.md](references/repository-map.md) when choosing a package, integration surface, or validation command.

For Client registration, Services, events, tools, Slots, or conversation nodes, read the sibling `../dsh-cordis-plugin-development/SKILL.md` completely. For Bundle, profile patch, preset, realm, or row-activation work, also read `../dsh-cordis-compositions/SKILL.md` completely. Pure view or CSS edits do not need the generic composition skill.

## Decide ownership before editing

- Keep Agent, Session, Runtime, RPC, Settings, Workspace, persistence, and tool execution in official Harness packages.
- Put DeepCreator UI and presentation state in one feature package under `packages/client`.
- Put cross-version public type imports and narrow adapters in `packages/client/compat`.
- Put declarative row replacement and insertion in `packages/bundle/deepcreator-web`.
- Put native window, official Host child process, navigation policy, and shutdown in `apps/desktop`.
- Do not add a neighboring Harness checkout as a runtime or build dependency.

If the requested behavior needs an official business-state mutation or an extension point that does not exist, stop before copying official state. Adapt a public API in `compat`, propose an upstream extension point, or explicitly scope a temporary fork.

## Implement a Client feature

1. Inspect the owning package README, public contracts, `src/client` assembly, tests, and current Bundle row.
2. Keep optional layers one-way: `contract` → `model-adapter` → `view-model` → `view`; create only the layers the feature needs.
3. Make React views pure props consumers. Read official Runtime objects in adapters or assembly code, not inside feature views.
4. Compose external UI with declared Slots. Use `ctx.slots.inject()` for a Slot owned elsewhere and register keyed renderers for open tool or conversation key spaces.
5. Wrap every registration in a reversible effect or retain its disposer.
6. Keep durable official data out of UI stores. Stores may own drafts, selection, active tabs, panel dimensions, and render preferences.
7. Update the package dependency, `deepcreator-web` dependency, and `dsh.client` row together when adding or removing a plugin.
8. Rebuild before browser validation because the Host serves `lib/client.js`.

## Change composition safely

- Treat `packages/bundle/deepcreator-web/cordis.patch.yml` as declarative product assembly, not a behavior switchboard.
- Disable only official UI rows that DeepCreator fully replaces; retain official Host and unchanged UI rows.
- Preserve official shared Slot names. Use `deepcreator.*` for product-owned child extension points.
- Do not rely on row order to satisfy Slot dependencies; wait on actual declarations.
- Treat `$DSH_HOME` as user data. Profile migration must back up, preserve unrelated third-party Bundles and patches, reject unmanaged targets, and remain idempotent.

## Validate by changed surface

Start narrow, then cover the assembled path:

```sh
pnpm --filter <package> typecheck
pnpm --filter <package> test
pnpm --filter <package> bundle
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:harness
```

- Bundle or profile: run `pnpm run profile:migrate`, inspect `dsh --profile deepcreator --dump-config`, and verify required rows have one owner.
- Browser UI: use a real browser for the affected settings, sidebar, conversation, trajectory, menu, and responsive states.
- Desktop: run Desktop tests, then start the application and verify dynamic-port readiness, exact-origin navigation, external links, errors, and child teardown.
- Official upgrade: update `compatibility.json`, official package versions, and the lockfile; compare composed config and run all compatibility, type, test, browser, and Desktop checks.

Do not run profile migration or mutate `$DSH_HOME` merely for a pure unit-test or CSS change.

## Finish the change

- Update `UI_STYLE_GUIDE.md` with every UI-system change.
- Update the owning README and architecture docs for public behavior, Slots, settings, package ownership, or upgrade changes.
- Check the final diff for generated files, local links, credentials, user profiles, and unrelated edits.
- Report commands actually run and distinguish source validation from live profile or Desktop validation.
