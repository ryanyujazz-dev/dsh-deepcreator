# DeepCreator repository map

## Ownership map

| Area | Owner |
|---|---|
| Official business state and execution | `@deepseek-ai/dsh` packages |
| Supported official version and public type face | `packages/client/compat` |
| Locale registry and language preference | `packages/client/locale` |
| Shared React controls and markdown/inspectors | `packages/client/ui-primitives` |
| Theme, typography tokens, smoothing, Appearance | `packages/client/ui-theme` |
| Root frame and panel presentation state | `packages/client/ui-layout` |
| Sidebar shell and Session tree | `packages/client/ui-sidebar` |
| Workspace browser and picker | `packages/client/ui-workspace` |
| Settings contracts | `packages/client/ui-settings` |
| Settings shell and Preferences Slot | `packages/client/ui-settings-general` |
| Conversation shell, chat flow, composer, render preference | `packages/client/ui-conversation` |
| Keyed tool rendering and details | `packages/client/ui-tool` |
| Trajectory projection, ledger, and timeline | `packages/client/ui-trajectory` |
| Preset, model, permission, subagent, and question surfaces | Matching `packages/client/ui-*` feature package |
| Declarative product assembly | `packages/bundle/deepcreator-web` |
| Managed local profile migration | `scripts/profile-migrate` |
| Official compatibility checks | `scripts/verify-harness` |
| Native process and security boundary | `apps/desktop` |

## Stable product values

- Profile: `deepcreator`
- Bundle: `@ryanyujazz/dsh-deepcreator-web`
- Conversation settings namespace: `ui-conversation`
- Conversation settings fields: `busyEnter`, `defaultRenderMode`
- Render-mode ids: `normal | classic | think`
- Default render mode: `classic`
- Preferences child Slot: `deepcreator.settings.preferences.item`
- Review panel type id (the change-reveal handoff target): `review`
- Official shared Slots retain their official names; inspect the owning `contract/slots.ts` before registration.

## Registration checklist

For a new Client plugin, confirm all of the following:

1. A package exists under `packages/client/<feature>` with Host and browser exports.
2. The workspace build and test configuration includes the package.
3. `packages/bundle/deepcreator-web/package.json` declares it.
4. `packages/bundle/deepcreator-web/cordis.patch.yml` inserts one stable row.
5. External Slot registrations wait through `ctx.slots.inject()`.
6. Every registration disposes on unload.
7. `lib/client.js` is rebuilt before a live probe.
8. `dump-config` contains one active owner and no retired row.

## Commands

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:harness
pnpm run profile:migrate
pnpm run dev:desktop
pnpm run start:desktop
```

`profile:migrate` writes user profile data and is not a routine check for source-only changes. Browser and Desktop probes use the managed profile after affected Client bundles are rebuilt.
