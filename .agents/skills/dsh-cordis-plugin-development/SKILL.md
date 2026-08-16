---
name: dsh-cordis-plugin-development
description: Extend a DeepSeek Harness (DSH) deployment by composing, configuring, or building Cordis plugins. Use when adding or changing a plugin row in cordis.yml or agent.cordis.yml, installing a plugin package, overriding plugin config, writing an in-tree or external Host or Client plugin (services, events, tools, Slots, conversation nodes), or verifying that an extension mounts and activates.
---

# Developing Cordis plugins for DeepSeek Harness (external agent edition)

DSH is a plugin-based agent harness on Cordis: the model adapter, tool registry, session log, agent loop, and every GUI feature are plugins in a composed tree. This skill is for agents outside a running DSH session. Runtime-only dynamic-plugin tools (`cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine`, `cordis_inspect_*`, `harness.registerTool`, live `ctx.slots.register`) are unavailable here; extend DSH through files, packages, and the `dsh` CLI. Load [dsh-cordis-compositions](../dsh-cordis-compositions/SKILL.md) for composition mechanics. Inside DeepCreator, also load the sibling [deepcreator-cordis-development](../deepcreator-cordis-development/SKILL.md) skill for repository ownership, commands, and validation.

## Orientation

- **Two planes.** The host composition owns process-wide registries (tools registry, sessions, persistence, sandbox/approval, model route, subagent registry). An agent preset owns what ONE session contributes: its tool rows, prompt sections, persona, compaction policy. Decide the plane first — see the plane tests in `dsh-cordis-compositions`.
- **Everything is a row.** Browser GUI features are `dsh.client` rows in a Bundle patch; Host features are ordinary rows. `dsh --profile <name> --dump-config` prints the composed tree the machine actually boots.
- **Where code lives.** In the official checkout, plugin packages live at `packages/<group>/<pkg>/`. External products may own a separate workspace; in DeepCreator, browser plugins live under `packages/client/*`. Built artifacts land in `lib/`, and Client packages serve `lib/client.js`.

## Route A — compose and configure existing plugins (no code)

Most extensions are rows, not code.

1. **Add a capability** — `insert` a row for an existing package into the profile patch (`$DSH_HOME/profiles/<name>/cordis.patch.yml`), the home patch, or a preset's `agent.cordis.yml`; a preset row mounts only for sessions on that preset, a host row mounts process-wide.
2. **Configure or disable** — an id-targeted patch replaces the matched row's WHOLE config (restate every key); `disabled: true` turns a row off. Config fields are the documented, validated surface: never edit plugin source to change a deployment-varying value ("no hardcoded tunables in plugins").
3. **Install a package** — `dsh plugin --profile <name> add <package>` installs an out-of-tree npm package into a profile. A row whose bare name is missing fails loud at boot (`Cannot find package …`).
4. **Verify** — `dsh --profile <name> --dump-config` shows the merged row and config; a running Web profile picks up user-layer patch edits live and retains the last good tree after a failed patch.

A quick map of where new behavior goes:

| Goal | Row / plane |
|---|---|
| Add a model-facing capability | register on `ctx.tools` (a tool row, usually in a preset); its schema joins prompt assembly |
| Give one session a different capability set | compose an agent preset; a service row there needs an `isolate` realm |
| Add a model provider | register its adapter on `ctx.llm` (host row) |
| Add shell / terminal / fs / sandbox | register a `ctx.shell` / `ctx.terminals` / `ctx.fs` / `ctx.sandbox` backend (host row) |
| Add a Web Client Chat node | register a `ConversationNodeDefinition` + keyed renderer (client plugin) |
| Add durable session state | extend `SessionEventMap`; render and replay from the log |
| Add UI or editor integration | drive `ctx.agents` and render from `session/event` |

## Route B — author plugin code

### Host plugin conventions

- **Two export shapes, never mixed.** A function plugin named-exports `name` / `inject` / `Config` / `apply` and has no default export. A service package default-exports its service class. Mixing the forms makes the Loader discard the function plugin's namespace.
- **Read optional services with `ctx.get('name')` and handle `undefined`.** Reserve `ctx.<name>` for declared injections; declare `inject: ['name']` only for hard dependencies the plugin must wait on. Never access `ctx.serviceName` undeclared.
- **Registrations are reversible effects.** Every contribution — tool schema, prompt section, listener, provider, adapter — goes through `ctx.effect()` / `ctx.on()` or a registry `register()` that returns a disposer; stop/update/remove must unwind it.
- **Events have dispatch modes.** `emit` observes, `waterfall` wraps (a listener MUST call `next()` to delegate, and return its value, unless it intentionally short-circuits), `parallel` fans out, `serial` runs in order with a return value. The mode is part of the event's public contract.
- **Model-visible means logged.** Anything that reaches a model request must be reconstructable from the session log; a new model-visible input requires a new session event, never ad-hoc state.
- **Capability seams are three roles.** A swappable capability = Service Definition (interface) + Service Provider (implementation) + Consumer (commonly a model tool). One role alone is not a seam; do not add a provider without its consumer, and never let one consumer dictate the service contract.
- **No hardcoded tunables.** Deployment-varying choices are validated `Config` fields changeable from cordis.yml; misconfiguration fails loud at load.
- Read the target repository's `AGENTS.md`, package README, public types, and existing neighboring plugins before implementation.

### Client plugin conventions

- **One UI feature = one plugin package** under `packages/client/<name>` (`@deepseek-ai/dsh-client-<name>`). The browser half lives in `src/client/`; a multi-domain package splits by future package boundaries with `contract/` (shared types) + domain directories that never import a sibling + `apply.ts` as the single assembly point.
- **Three registration surfaces, all required** — missing any one fails later: the package participates in the repository build graph; a Bundle contains its `dsh.client` row; that Bundle declares the bare package dependency.
- **`dsh.client` manifest semantics** — `platform: 'web'` always; `immediately: true` only for stage-one-prefetch infrastructure; `inject` edges are informational only (they do not sequence activation — Cordis waits on services, nothing else).
- **Composition is slots, and only slots.** A plugin composes UI through `ctx.slots.register({ name, children?, store?, inject? }, Component)`; the shell alone renders `'root'`. The `children` keys you declare are exactly the slots your component may render (declaration = render authorization; rendering an undeclared slot or declaring someone else's fails at load). Register into another package's slot with `ctx.slots.inject(name, () => ctx.slots.register(...))` — it waits on the actual declaration and removes the contribution when that declaration collapses.
- **Keyed slots carry runtime-open key spaces.** `tool.call.toolview` dispatches by `key: <wire tool name>` with a generic fallback; business packages register atomic Tool views there. Do not modify a central renderer switch.
- **Chat business rows are registrations, not folds.** A new chat row declares a typed `ChatNodeDataMap` key, registers a `ConversationNodeDefinition` (match/update, deterministically replayable by log seq), and registers the matching keyed renderer on `conversation.chat.node`. Never add a branch to `Session`, `SessionManager`, or a central built-in dispatcher.
- **Layering is one-way.** Business data lives in the official React-free Runtime; render machinery is ctx↔React glue; components are pure props consumers. Shared viewing state (selection, drafts, panel widths) may live in an entry-declared store, but business data may not.
- **Rebuild before probing** — `pnpm --filter <pkg> bundle` emits `lib/client.js`; the registry serves built bundles, not sources. Run the package's tests and repository typecheck before a live probe.
- Read the repository's root and nested `AGENTS.md` files for local package and validation rules.

## Verification ladder

1. **Composition** — `dsh --profile <name> --dump-config` shows the row, package, and merged config; a preset row must also pass structural, package-resolution, and realm checks from `dsh-cordis-compositions`.
2. **Code** — run the narrowest package tests, repository typecheck, and `pnpm --filter <pkg> bundle` before a live probe.
3. **Hand off to the user** — only a real session shows what a composition produces. Ask the user to start a session (preset rows) or reload the running instance (host rows) and confirm the tool list, prompt sections, and UI.

## Common failure checks

| Failure | Check first |
|---|---|
| `Cannot find package …` at boot | The row's bare `name` is not installed; add it to the profile or confirm spelling against `dsh --profile <name> --dump-config` |
| `invalid config: $.<field> missing required value` | The patch replaced the whole config and dropped a field; restate every key |
| `service "<name>" has been registered at <Owner>` | A preset row published a service into the process-global realm; wrap provider + consumers in one `isolate` group |
| `N row(s) did not activate: <id>: waiting for <service>` | The row's `inject` names a service nothing in its visible plane provides |
| GUI feature missing from the page | One of the three registration surfaces is missing (tsconfig aggregate / `dsh.client` row / bundle dependency), the client bundle was not rebuilt (`pnpm --filter <pkg> bundle`), or the row is `disabled` |
| Slot registration fails at load | The slot name was not declared by the parent entry's `children`, or the protocol (single/list/keyed/chain) and options were guessed instead of read from the parent's declaration |
| New chat row renders nothing | The `ConversationNodeDefinition` or its keyed `conversation.chat.node` renderer is missing, or the event ids are not stable/replayable |
| Service never provided | A function plugin that should provide a service has a default export or a missing `apply`; a service class was registered through the wrong export shape |
| Behavior differs between sessions | The row belongs on the host plane (process-wide table or cross-session consumer) but was composed per-preset — see the plane tests |
