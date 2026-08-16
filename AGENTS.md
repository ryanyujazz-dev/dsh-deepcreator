# DeepCreator repository instructions

These instructions apply to the entire repository. A nested `AGENTS.md` adds directory-specific rules without replacing these rules.

## Product boundary

- DeepCreator is an independent Desktop and Web presentation distribution over the official DeepSeek Harness runtime.
- Reuse the official Host, Agent, Session, Runtime, RPC, Settings, Workspace, and Slot systems. Do not copy their business state into this repository.
- Do not depend on a neighboring Harness source checkout. Official runtime and public types come from pinned npm packages; `packages/client/compat` owns the supported version declaration.
- DeepCreator-owned behavior must remain a Cordis plugin contribution that can be inserted, disabled, and disposed through the composed tree.

## Architecture

- Keep one UI feature per package under `packages/client`.
- Inside a feature, dependencies flow from `contract` to `model-adapter` to `view-model` to `view`; `apply.ts` is the assembly point. Create only the layers the feature needs.
- React views consume props. They must not access Cordis context, RPC clients, SessionManager, or external subscriptions directly.
- Cross-plugin UI composition uses Slots. Cross-plugin behavior uses public Services, Events, stores, and ordinary data or callbacks. Never import another feature's internal component.
- Tool and conversation rendering use keyed registrations. Do not introduce a central renderer switch.
- Every registration is reversible through `ctx.effect()`, `ctx.on()`, or a registry disposer.
- Presentation stores own UI state only. Official Runtime objects remain authoritative for sessions, workspaces, agents, settings, and execution state.

## Development

Use Node.js `^22.19 || >=24` and pnpm.

For Cordis, Client plugin, Bundle, profile, compatibility, or Desktop integration work, use the repository-local `deepcreator-cordis-development` skill under `.agents/skills/`. It routes to the two complete generic DSH Cordis skills when their lower-level workflows apply.

```sh
pnpm install
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:harness
```

Run the narrowest relevant check while iterating, then run all affected package checks before handoff. Rebuild Client packages before browser or Desktop validation because the Host serves `lib/client.js`.

## Change discipline

- Preserve ESM, strict TypeScript, explicit public types, and package-boundary imports.
- Do not edit generated `lib/`, `node_modules/`, Playwright output, profile dumps, or user data as source.
- Misconfiguration and unsupported official versions fail with an actionable error; do not add silent fallbacks.
- A UI style change must update `UI_STYLE_GUIDE.md` in the same change. Text uses real `font-size` and `line-height`, never `transform: scale()`.
- Update the owning README and architecture documentation when behavior, package ownership, public Slots, settings, or upgrade steps change.
- Never commit credentials, `$DSH_HOME` contents, local absolute development links, signing material, or generated user profiles.

## Composition and verification

- The composed tree from `dsh --profile deepcreator --dump-config` is the authority for active rows.
- A Client row requires a package dependency, a Bundle row, and a built browser entry. Missing any one is a load failure.
- `inject` metadata documents dependencies but does not impose activation order. Wait for external Slots with `ctx.slots.inject()`.
- Profile and Bundle patches are top-level lists. An id-targeted patch replaces the complete config for that row.
- Validate changes through unit tests, typechecking, bundle output, `dump-config`, and a real browser or Desktop smoke test in proportion to the changed surface.
