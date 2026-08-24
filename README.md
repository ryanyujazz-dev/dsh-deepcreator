<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="DeepCreator combines an agent conversation with a composable Workbench for artifacts, review, terminal, activity, and browser surfaces">
</p>

<p align="center">
  A focused Desktop and Web workspace for running agents, following their work, and inspecting what they produce.
</p>

<p align="center">
  <code>DeepSeek Harness 0.1.1-rc.2</code> · <code>Development runtime</code> · <code>#dsh-plugin</code>
</p>

<p align="center">
  <a href="#product-tour">Product tour</a> ·
  <a href="#a-conversation-that-stays-readable">Conversation</a> ·
  <a href="#the-workbench-stays-beside-the-transcript">Workbench</a> ·
  <a href="#agent-capabilities-that-ship-today">Capabilities</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#architecture">Architecture</a>
</p>

DeepCreator is an independent presentation distribution over the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It keeps the official Host, Agent, Session, Runtime, RPC, Settings, Workspace, and Slot systems authoritative, while replacing the product-facing experience with a task-centered conversation and a panel-based Workbench.

The result is one place to read a long-running agent, answer approvals and questions, inspect tool activity, review repository changes, open generated files, operate a terminal or browser, follow subagents, and manage the Skills available to the current workspace.

## Product tour

<p align="center">
  <a href="./assets/readme/product-conversation.png"><img src="./assets/readme/product-conversation.png" width="100%" alt="DeepCreator showing an image-generation turn inside the current conversation interface"></a>
</p>

<p align="center"><sub>A current DeepCreator session: workspace navigation, readable tool flow, generated media, model and permission controls, and live execution statistics.</sub></p>

| Area | What is available now |
| --- | --- |
| **Conversation** | Native, Classic, and Think render modes; stable streaming; grouped tool execution; approvals, questions, plans, todo state, queued messages, compaction, retries, and context injections |
| **Workbench** | Session-scoped Terminal, Activity, Artifact, Review, and Browser panels with tabs, mosaic layout, focus mode, responsive placement, and persisted viewing state |
| **Outputs** | Produced-file cards, Markdown/code/image/PDF/Word viewers, HTML preview handoff, generated-image attachments, and explicit in-app presentation |
| **Agent operations** | Graphical Skills management, browser automation, image generation, model and permission selection, presets, workspace/session search, subagent transcripts, and execution trajectory |
| **Surfaces** | Sandboxed Electron Desktop, the same composed Web UI, and optional paired access from a phone on a trusted LAN |

## A conversation that stays readable

DeepCreator keeps the official Harness conversation available as **Native**, then adds two task-reading modes:

| Mode | Best for | Presentation |
| --- | --- | --- |
| **Native** | Following the original Harness experience | Preserves the official flow and remains the stable fallback |
| **Classic** | Reading the result and the work without reasoning noise | Hides reasoning, groups contiguous tools into expandable execution runs, and keeps assistant prose in one continuous flow |
| **Think** | Following how the agent reaches a result | Shows reasoning inline and keeps each execution run scoped to its step |

Classic is the initial default. The current session picker and the default preference stay synchronized, so a change applies immediately and becomes the starting mode for later sessions.

The flow is more than a renderer switch:

- Tool calls dispatch through keyed registrations, so specialized cards and unknown third-party tools coexist without a central switch.
- Streaming tails, settled rows, reader position, pagination, and retry state remain stable during long turns.
- Approvals, plan review, and user questions take over the composer in place, then return it when the Host resolves the wait.
- Todo progress, queued messages, steering, compaction checkpoints, context injections, token statistics, and terminal failures keep their chronological place.
- **Trajectory** adds a virtualized, turn-aware event ledger with nested tools, timing, token usage, search, folding, record inspection, and a zoomable execution overview.

## The Workbench stays beside the transcript

Workbench is the contextual right-hand workspace, not a detached developer console. Panels can share a mosaic, open multiple same-type tabs, move into focus mode, persist per Session, and adapt from desktop columns to a full-width phone overlay.

<p align="center">
  <a href="./assets/readme/product-workbench.png"><img src="./assets/readme/product-workbench.png" width="100%" alt="DeepCreator Workbench showing repository review beside its agent conversation"></a>
</p>

<p align="center"><sub>Repository work stays connected to its conversation: inspect the complete change scope without leaving the transcript that produced it.</sub></p>

| Panel | What it does |
| --- | --- |
| **Terminal** | Runs an interactive local system shell at the Session workspace, with raw ANSI I/O, resize, tabs, and lifecycle ownership retained by the official terminal service |
| **Activity** | Lists background jobs and subagents, stops owned jobs, and opens a child transcript that reuses the main conversation renderer without duplicating Session state |
| **Artifact** | Projects the files the agent actually produced; renders code, Markdown/MDX, images, PDFs, DOCX, and DOC in place; routes explicit HTML preview to Browser |
| **Review** | Shows unstaged, staged, uncommitted, current-turn, and historical-turn scopes; virtualizes large diffs, supports nested repositories, and can safely undo the newest unresolved single-repository turn |
| **Browser** | Presents provider-neutral browser tabs and snapshots through built-in Electron, managed Playwright, or explicitly shared Chrome providers |

Artifact and Review deliberately remain separate. Artifact answers “what did the agent make?” while Review answers “what changed in this repository?” Binary outputs stay visible as deliverables without being duplicated as line-review cards.

## Agent capabilities that ship today

### Skills, managed from the same workspace

The graphical Skills section reads the effective official registry for the live Agent and workspace. It supports bilingual search, enable/disable policy, details and authorship, guarded install by copy/link/Git, and removal from the standard personal or project Skill roots. Disabling a Skill changes both model and user invocation policy without rewriting the provider's source.

### Image generation with durable results

The root Agent can call `create_image` through configured **OpenAI Images**, **Volcengine Ark Seedream**, or **Gemini** providers. Provider profiles live in official Settings, credentials resolve through the official Credentials service, system proxy settings are inherited by Desktop, and bounded per-turn retry/circuit-breaker behavior prevents uncontrolled failure loops. Successful generations create one workspace PNG plus a durable conversation attachment.

### Browser use without leaking provider internals

Browser Core exposes semantic navigation, interaction, snapshot, and tab operations while keeping Electron `WebContents`, Playwright objects, Chrome debugger handles, and native IPC behind provider boundaries.

- Built-in Browser uses a sandboxed Electron surface and authenticated private Desktop RPC.
- Managed Chromium, Firefox, and WebKit add semantic automation plus `playwright_run`; scripts execute inside QuickJS/WASM without Node globals, filesystem, process, or sockets.
- System Chrome integration shares only tabs the user explicitly approves from the extension action and does not open a remote-debugging port.

### Explicit presentation, not panel guessing

`open_in_deepcreator` coordinates artifacts and browser resources through resolver, capability, claim, receipt, timeout, and dismissal boundaries. The Host knows whether a resource was actually presented; a failed mount is not mistaken for a successful panel-open hint.

### The surrounding product workflow

- Workspace groups, pinned Sessions, manual/recency ordering, title/path search, content search, fork, archive, and pending-interaction status.
- Agent and model presets, reasoning level, permission presets, safe Full Access confirmation, and structured user questions.
- Generated-file cards and per-turn change cards directly connected to Artifact and Review.
- A shared semantic theme system for typography, code, diffs, controls, menus, focus, scrollbars, and light/dark appearance.

## One composition, three surfaces

| Surface | Behavior |
| --- | --- |
| **Desktop** | Sandboxed Electron window, official `dsh` child process on a dynamic loopback port, strict navigation policy, native macOS traffic lights, themed Windows Window Controls Overlay, and Linux native frame |
| **Web** | The same Client row composition served by the official Host; no second product state or alternate UI implementation |
| **Trusted-LAN phone** | Optional device pairing to the same responsive Web UI; Activity, Artifact, and read-only Review remain available while Browser, Terminal, native path actions, and privileged administration stay fenced |

> [!WARNING]
> Trusted-LAN access uses authenticated **HTTP without transport encryption**. It is disabled by default, installs no certificate, and must never be exposed to a public network or the internet.

## Quick start

### Requirements

- Node.js `^22.19 || >=24`
- [pnpm](https://pnpm.io/)

### Run DeepCreator Desktop

```sh
pnpm install
pnpm run build
pnpm run profile:migrate
pnpm run dev:desktop
```

`profile:migrate` creates the managed `deepcreator` profile from the existing `web` profile. It backs up both profiles, preserves unrelated third-party Bundles and user patches, removes retired rows, links the local plugins, and validates the assembled Cordis tree. Later Desktop starts run the lightweight `profile:ensure` check and migrate only when the managed composition is stale.

The original `web` profile remains the rollback path.

<details>
<summary><strong>Add official Harness plugins to the managed profile</strong></summary>

DeepCreator keeps the official Host and Agent plugin seams open. Install the package version matching the pinned Harness runtime, add its documented Cordis row to `$DSH_HOME/profiles/deepcreator/cordis.patch.yml`, inspect the complete composition, then restart:

```sh
pnpm --filter @ryanyujazz/dsh-deepcreator-desktop exec dsh plugin --profile deepcreator add @deepseek-ai/dsh-mcp-client@0.1.1-rc.2
pnpm --filter @ryanyujazz/dsh-deepcreator-desktop exec dsh --profile deepcreator --dump-config
```

Useful official additions verified against the pinned runtime include MCP servers, DeepSeek-backed web search/fetch, worker-thread agent workflows, and opt-in OpenTelemetry. Installing a package does not activate its Cordis row by itself.

</details>

## Architecture

DeepCreator changes the presentation and product workflow without forking Harness business state:

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Desktop process | DeepCreator | Electron lifecycle, official Host child, proxy projection, Browser surface boundary, navigation, and shutdown |
| Host feature plugins | DeepCreator | Browser, presentation, artifacts, review, terminal Workbench, Skills administration, image generation, jobs/session administration, and trusted-LAN access |
| Presentation bundle | DeepCreator | Declarative Cordis row replacement/insertion and the complete plugin dependency closure |
| Client features | DeepCreator | Slot-composed React views and presentation-only stores, one feature per package |
| Runtime and business data | DeepSeek Harness | Agent execution, Sessions, workspaces, RPC, Settings, credentials, tools, Client Runtime objects, and official extension points |

The composed order is `dsh-base` → `dsh-web-app` → retained third-party Bundles → `dsh-deepcreator-web`. The output of `dsh --profile deepcreator --dump-config` is the authority for the active tree.

Three rules keep the distribution independently upgradeable:

1. React views consume props; adapters and assembly code read Runtime or Remote data.
2. Cross-plugin UI uses Slots, while behavior uses public Services, Events, stores, callbacks, and ordinary data.
3. Every registration is reversible, and official Agent/Session/Runtime/Workspace/Settings state is never copied into a presentation store.

Read [the architecture reference](./docs/architecture/deepcreator.md) for ownership, Slots, composition invariants, compatibility, and the upstream update procedure.

### Repository map

| Path | Purpose |
| --- | --- |
| `apps/desktop/` | Electron window, official Host child process, native Browser surfaces, navigation, and shutdown |
| `packages/host/` | DeepCreator-owned Host services and Agent-facing capabilities |
| `packages/client/ui-conversation/` | Conversation shell, three render modes, streaming flow, composer, queue, and status |
| `packages/client/ui-workbench*/` | Workbench shell plus Activity, Artifact, Review, and Terminal providers |
| `packages/client/ui-browser/` | Browser state and default Workbench presenter |
| `packages/client/ui-skills/` | Graphical effective-Skill catalog and lifecycle controls |
| `packages/client/ui-image-generation/` | Image-generation settings, tool row, and generated media |
| `packages/client/ui-trajectory/` | Turn-aware execution ledger, timeline, search, and inspector |
| `packages/bundle/deepcreator-web/` | Public presentation Bundle and authoritative Cordis patch |
| `scripts/profile-migrate/` | Managed profile migration and idempotent startup ensure |
| `scripts/verify-harness/` | Supported-version and composition-invariant checks |
| `UI_STYLE_GUIDE.md` | Product typography, interaction, component, and platform-window rules |

## Compatibility and current scope

The compatibility declaration targets DeepSeek Harness `0.1.1-rc.2` at Git SHA `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

> [!IMPORTANT]
> DeepCreator currently ships as a **development runtime**. Signing, notarization, installers, auto-update, tray integration, and native credential storage are intentionally outside the current Desktop release. Review does not provide stage, unstage, or commit actions; trusted-LAN access is not a TLS or PWA deployment.

## Development

```sh
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run verify:harness
```

Tests resolve Harness modules from pinned npm packages, so the repository does not depend on a neighboring source checkout. Rebuild Client packages before browser or Desktop validation because the Host serves `lib/client.js`.

For repository-aware agent work, start with [`.agents/skills/deepcreator-cordis-development/SKILL.md`](./.agents/skills/deepcreator-cordis-development/SKILL.md).

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party attribution.
