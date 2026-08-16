# dsh-deepcreator

DeepCreator is an independent desktop presentation layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It reuses the official Host, Agent, Session, Runtime, RPC, Settings, and Slot renderer while owning its Electron shell and product UI as Cordis Client plugins.

## Development

Requirements: Node.js `^22.19 || >=24` and pnpm.

```sh
pnpm install
pnpm run build
pnpm run profile:migrate
pnpm run dev:desktop
```

`profile:migrate` creates the managed `deepcreator` profile from the existing `web` profile, backs up both profiles, retains third-party bundles and user patches, removes legacy ExecFlow rows, links every local Client plugin required by the development profile, and validates the assembled Cordis tree. Re-running it refreshes the managed profile without duplicating bundles or rows. The original `web` profile remains available as the rollback path.

## Repository layout

- `apps/desktop/` owns the Electron window, Host child process, navigation policy, and shutdown lifecycle.
- `packages/client/` contains feature-domain Client plugins, the `compat` library, and the shared `ui-primitives` Client module.
- `packages/bundle/deepcreator-web/` replaces only DeepCreator-owned official UI rows.
- `scripts/profile-migrate/` creates and verifies the `deepcreator` profile.
- `scripts/verify-harness/` checks the supported official version and composition invariants.
- `.agents/skills/` carries the complete external DSH Cordis workflows plus the DeepCreator-specific development workflow for repository-aware agents.
- `UI_STYLE_GUIDE.md` owns product typography and interaction styling.
- `docs/architecture/` owns package boundaries and the upstream update procedure.

## Architecture rules

- One UI feature is one plugin package. Model adapters, view state, pure views, and `apply.ts` remain inside that feature.
- Components receive data and callbacks through Slot-derived props; they do not access Cordis context or subscribe to Runtime objects directly.
- Cross-plugin composition uses Slots, Services, Events, and ordinary data. Tool and conversation renderers use keyed registrations rather than central switches.
- Official business state stays in the React-free Harness Runtime. DeepCreator stores contain presentation state only.
- Registrations are reversible effects. A plugin unload must remove every Slot, event listener, service contribution, and store binding it owns.

See [the architecture reference](docs/architecture/deepcreator.md) for ownership and upgrade requirements.

Repository-aware agents should start with `.agents/skills/deepcreator-cordis-development/SKILL.md`. It conditionally loads the generic composition and plugin-development skills so pure UI work does not consume unrelated Cordis context.

## Release boundary

The initial desktop delivery is a development runtime. Signing, notarization, installers, auto-update, tray integration, and native credential storage remain outside this release.
