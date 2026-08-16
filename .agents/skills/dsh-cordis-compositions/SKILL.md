---
name: dsh-cordis-compositions
description: Author, edit, and validate DeepSeek Harness (DSH) Cordis compositions — agent presets under the Harness home, host profile patch files, plugin rows, and the host-composition-vs-agent-preset plane decision. Use when creating or changing cordis.yml / agent.cordis.yml / preset.yml files, adding or removing a plugin row, deciding whether a capability belongs in the host composition or one session, or diagnosing a row that mounted but contributed nothing.
---

# Editing DeepSeek Harness Cordis compositions

DeepSeek Harness (DSH) is a plugin-based agent harness on Cordis: every capability is a plugin row in a `cordis.yml`. There is no separate configuration language — changing what an agent can do means changing which rows are composed for it. This skill is the external-platform port of the harness's own `editing-cordis-compositions` skill; it uses only file tools and the `dsh` CLI, so it works from any agent platform.

## Locate the deployment first

The Harness home resolves as `$DSH_HOME`, else `~/.dsh` (Windows: `%USERPROFILE%\.dsh`).

| Thing | Path |
|---|---|
| Profiles (one directory per profile) | `$DSH_HOME/profiles/<name>/` — `package.json` declares `dsh.profile.bundles`; the user layer is `cordis.patch.yml` next to it |
| Home-level patch (outranks every per-profile patch) | `$DSH_HOME/cordis.patch.yml` |
| Locally authored agent presets | `$DSH_HOME/.agent-presets/<id>/agent.cordis.yml` (+ optional `preset.yml`) |
| Shipped agent presets (`standard`, `code`, `minimal`, `cordis`) | Beside the deployment's own config; in a repo checkout: `apps/cli/config/agent-presets/` |

See exactly what the machine boots with:

```sh
dsh --profile web --dump-config    # the full composed tree: bundles + user layer + overlays
dsh web --dump-config              # alias of the above
dsh --dump-default-config          # bundle layers only, without user layer or --patch overlays
```

In a Harness checkout, prefix with `pnpm`: `pnpm dsh --profile web --dump-config`. `web` and `headless` profiles auto-initialize on first use; other profile names must already exist or be created through the product's documented profile workflow.

Inside DeepCreator, use `pnpm run profile:migrate` to create the managed profile and inspect it with `dsh --profile deepcreator --dump-config`. Read the sibling [deepcreator-cordis-development](../deepcreator-cordis-development/SKILL.md) skill before changing its Bundle or managed profile.

## Off-limits

**Never edit, delete, or overwrite a preset that ships with the deployment** (the `agent-presets` directory beside the deployment's own config — `standard`, `code`, `minimal`, `cordis`). An upgrade overwrites that install, and corrupting `cordis` disables preset authoring itself. Reading a shipped composition is the intended way to start; writing to one is not, and neither is editing the host composition to work around a preset limitation.

To change what a shipped preset does, copy the directory and edit the copy under `$DSH_HOME/.agent-presets/<id>/`.

## Decide the plane first

Two planes, and the choice is not about how "agent-related" something feels — it is about whether the thing must be shared.

**Host composition.** The registries themselves (`tools`, `systemPrompt`, `agents`, `agent-loop`, `sessions`), anything crossing sessions (persistence, session query, storage, settings, credentials, telemetry), the sandbox and approval stack, the model route, and the subagent registry with its spawn/fork backends. One instance for the process.

**Agent preset.** What one session contributes to those registries: its tool plugins, its persona and prompt sections, its compaction policy. One instance per session, mounted under that session's scope and unwound with it.

Tests that settle a disputed row (from the harness's own decision record):

1. **Injection test** — does a host row `inject` the service? Then it must be host-plane: injection resolves before any session exists, so there is no agent to key by.
2. **Process-wide table test** — does the service register into a process-wide registry (session projections, token meter)? A per-session copy makes one session's behavior depend on which other presets happened to mount.
3. **Empty-value test** — is the service's empty value indistinguishable from a real one (a token-usage count, not an empty list)? Then it cannot be per-composition; a reader would answer for every session. Units whose empty value is readable (`plan.active`, an empty list) can stay per-preset.
4. **Consumer test** — a service with a consumer outside the agent plane cannot move into a preset. `subagents` is the worked example: the registry answers cross-session queries for the host api-proxy, so a per-session copy both starves that host row and collides on the second session. The preset contributes the delegation *tools*; the registry and its backends stay host-side.

## Authoring a preset

1. **Start from a copy.** `standard` is the full coding agent and the usual source. Copy its whole directory (composition, `preset.yml`, skill directories, assets) into `$DSH_HOME/.agent-presets/<id>/`. On Windows: `Copy-Item -Recurse`; on POSIX: `cp -r`. If a DSH instance is running, its roster re-reads the roots on every list/mount, so the new preset is visible without a restart.
2. **Name the directory well.** The id must match `[a-z0-9][a-z0-9-]*` — it becomes the directory name, so no leading hyphen, no path separators, no `..`. Discovery skips a directory whose name is not a usable id.
3. **Rewrite `preset.yml`** — display metadata only. A user-authored preset carries exactly two keys (shipped presets may additionally carry a roster `order`, which a copy drops):
   ```yaml
   name: <display name>
   description: <one-line description>
   ```
   A copy keeps its source's description but must drop the source's name and roster `order`; a hand-written file should carry its own. Without it the preset shows in every picker as its bare directory name.
4. **Edit `agent.cordis.yml`** row by row, keeping the plane rule and the realm rule below.
5. **Verify** (see "Verifying a change"), then hand off to the user for a real session.

A composition written from scratch usually forgets a group realm or a consumer row; a copy starts loadable.

## The rule that catches people: realms

**A row that publishes a service may not sit loose in a preset.** Registering a service without an isolate realm puts it in the process-global realm, so the second session mounting that preset collides with the first. The mount rejects it rather than letting the collision surface later.

When a preset genuinely owns a service, wrap the provider **and every consumer that reaches it** in one group carrying an `isolate` realm. The shipped `standard` composition does this for `workflows`, which nothing outside an agent reads:

```yaml
- id: delegation
  name: cordis:group
  group: true
  isolate:
    workflows: true
  config:
    - id: workflow-worker-thread
      name: '@deepseek-ai/dsh-workflow-worker-thread'
      config:
        provider: spawn
    - id: tool-workflow
      name: '@deepseek-ai/dsh-tool-workflow'
```

`true` means a realm private to each mounting session. A consumer left outside the group resolves the host's registry, which the preset did not populate, and then contributes nothing.

Realms are for services a preset owns, not for every group. A host capability the preset only consumes must stay outside a realm, or the row cannot resolve it: `tool-bash`, `tool-jobs`, and `tool-goal` publish nothing and sit loose in `standard`. Wrapping a consumer row in a realm of its own is the same error as leaving one outside its provider's realm.

How preset rows resolve: a row's **bare package name** resolves from the host composition, not from the preset directory (a locally authored preset lives under the user's home, where Node's upward `node_modules` walk never reaches the harness). A **relative** path resolves from the preset's own directory — so a preset's own plugin files and skill directories travel with it.

## Editing host patches

The patch files (`$DSH_HOME/profiles/<name>/cordis.patch.yml`, the home-level `$DSH_HOME/cordis.patch.yml`, and any `--patch <path>` overlay) are top-level YAML arrays of patch entries:

- **Override by id** — replaces the matched row's WHOLE config, not a deep merge. Restate every key you keep:
  ```yaml
  - id: tool-web
    config:
      searchMaxResults: 5
  ```
- **Insert rows**:
  ```yaml
  - insert:
      - id: my-row
        name: '@deepseek-ai/dsh-some-package'
        config:
          someKey: value
  ```
- **Disable a row** — `disabled: true` (the `disabled` field is evaluated at every mount decision; a disabled row mounts nothing and contributes nothing).

Patch mechanics to respect:

- A patch naming an entry id absent from the composed tree is a stderr warning, not an error.
- An empty or comments-only patch file throws (it parses to nothing, not a list). Disable the layer with `[]`.
- `!!js` expressions are allowed in a row's `config` (interpolated after declared injections activate, against that plugin's context: `ctx.<service>`, `process.env.X`, `dshHomePath('storages')`) and in `disabled`. Other entry metadata stays literal. Use overlays when the environment selects plugins.
- Layer order: bundles (in profile order) → profile `cordis.patch.yml` → home-level `cordis.patch.yml` (outranks per-profile) → `--patch` overlays (argv order).
- Install an out-of-tree package into a profile: `dsh plugin --profile <name> add <package>`.

A running `dsh web` keeps the user patch layer live: edits to `cordis.patch.yml` are watched and recomposed without a restart. A failed patch leaves the last good tree running.

## Verifying a change

The harness's runtime mount-validation (`standingKeyFor`) is not available outside a DSH session. Use these substitutes, in order:

1. **Structural check** — the composition parses in YAML (the loader's dialect, `!!js` included), is a top-level list, and every row is named (`id`, plus `name` for package rows; `cordis:group` and `cordis:include` are builtins, not packages).
2. **Package-resolution check** — every bare `name` in your preset must already exist in the host tree or be installed where the host resolves. Confirm against `dsh --profile web --dump-config` (the composed tree prints every row and its package), or `dsh plugin --profile <name> add <package>` for a missing package.
3. **Realm check** — a preset row that publishes a service must sit inside a group with `isolate`; a consumer of a host service must stay outside any realm. Statically verify the pattern; the mount rejection names the offending service if you get it wrong.
4. **Config check** — a config override restates every field the bundle row owned; dropping one surfaces as `invalid config: $.<field> missing required value` at boot.
5. **Hand off to the user** — only a real session shows the agent a composition produces: ask the user to start a session on the new preset (or restart the profile for host patches) and confirm the tool list and prompt behavior. The preset decides tool schemas and prompt sections; the roster's `broken` flag only reports shape damage, not an unusable composition.

## Common failure checks

| Symptom | Check first |
|---|---|
| `Cannot find package …` at mount | The row's bare `name` is not in the host tree and not installed; add it with `dsh plugin --profile <name> add <package>` or confirm the spelling against `dsh --profile web --dump-config` |
| `invalid config: $.<field> missing required value` | An id-targeted patch replaced the whole config and dropped a field the bundle row owns; restate every key |
| `service "<name>" has been registered at <Owner>` | A preset row published a service into the process-global realm; wrap the provider and its consumers in one `isolate` group |
| `N row(s) did not activate: <id>: waiting for <service>` | The row injects a service nothing in its visible plane provides — a consumer outside its provider's realm, or a host-only service a preset row expects |
| Row absent from `dsh --profile web --dump-config` | The patch named an id the tree does not have (stderr warning), the patch file parsed to nothing (`[]` it), or the layer order put your edit under a later full override |
| Preset not shown in the roster | The directory name is not a valid id, the composition does not parse, or the root is wrong — presets live under `$DSH_HOME/.agent-presets/`, shipped ones beside the deployment config |
| New preset's rows never activate | A row resolves the host's registry the preset never populated — move the consumer inside its provider's realm, or the provider into the host composition |
