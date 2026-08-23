# Artifact Panel Design

Status: **phase 1 implemented on the official deliverables fact**. This
document defines the DeepCreator Workbench Artifact panel (产物面板). The
panel is a read-only window into the official produced-files mechanism:
the same session events the official `ui-deliverables` plugin renders at the
conversation turn tail, projected into a Workbench list. Architecture docs
under `docs/architecture/` and package READMEs are updated together with each
implemented phase.

A design review earlier proposed a DeepCreator-owned artifact vocabulary
(`artifact_declare`/`artifact_revise` tools, `artifact/*` session events, a
Host registry). That direction was **withdrawn** after review: the official
harness already owns a produced-files fact (files the model actually wrote),
and the panel must collect exactly that fact rather than a parallel
vocabulary. The tool pair, the events, and the registry are removed.

## Goals

- Close the artifact loop end to end: the model writes files, the Workbench
  Artifact panel shows them live, and the user opens one in a rendered view.
- Keep every architectural invariant: business facts stay in the official
  session log, presentation state in the Workbench, composition through Slots
  and keyed registrations, everything reversible.
- Make the renderer set an open keyed space so future kinds (and third-party
  plugins) add renderers without touching a central switch.

## Non-goals

- Editing artifact content from the panel. The Artifact surface stays
  read-only; writes keep belonging to official filesystem tools and the model.
- A DeepCreator-owned artifact vocabulary (declaration tools, custom session
  events, Host registry). The official produced-files fact is authoritative;
  DeepCreator adds no parallel business state.
- Cross-session or workspace-scoped artifact browsing. The panel type remains
  `scope: 'session'`.

## The official produced-files fact

Official `@deepseek-ai/dsh-client-ui-deliverables` derives "deliverables" per
conversation turn from session events:

- `turn/start` starts a turn context.
- `tool/call` records the call's view.
- An append-surface `tool/result` (non-error) collects paths from the call
  view by **render intent, not tool name**: a `diff` card, or a generic card
  whose `kind` is `edit`, contributes its `locations` paths. Reads, deletes,
  failed results, and replacement surfaces (compaction) contribute nothing.

DeepCreator keeps the official row composed for its Turn facts, closing-prose
links, and model guidance. Artifact contributes the higher-priority visual
winner to the same selector chain: an expandable card containing only that
closing Turn's produced files. Review renders its independent change card in
the additive DeepCreator slot immediately below it, so a path may appear in
both cards with different navigation.

## Data flow (phase 1, implemented)

The panel is a second projection over the same fact:

1. `ArtifactNodeDefinition` — `kind: 'workbench-artifact'`, one node per turn.
   `match()` accepts `turn/start` (start) and `tool/call` / append-surface
   `tool/result` (update); the reducer mirrors the official derivation above.
2. `ArtifactsSnapshotBuilder` — `ConversationViewDefinition` with
   `target: 'artifacts'` folding turn nodes into one record per path (latest
   production wins), newest first. Registration and disposal ride
   `ctx.conversationEvents` / `ctx.conversationViews` exactly as trajectory's
   do.
3. The panel reads the snapshot through the session store (no separate
   polling, no plugin-owned copy of business data). Reconnects, older-page
   prepends, and log replay are correct by construction because the fold is
   deterministic.

Truncated-window semantics: a turn whose `turn/start` lives in an unloaded
older page stays invisible until that page loads — updates without a start
never materialize a node. There are no tombstones: the official fact never
retracts, so a produced path stays listed.

### Content reads

- The active instance body reads through the Host `artifacts` remote
  (`@ryanyujazz/dsh-artifacts`, now a read-only workspace file reader): the
  path is canonicalized and fenced to the session workspace, utf8 content
  returns, and escaping paths / missing files / workspace-less sessions fail
  with explicit codes. The read is keyed by path — unchanged paths keep
  content.
- **Truncation** stays deferred (phase 2): `read` has no cap today.

### New-artifact dot (phase 1, implemented)

The type entry icon (the `deepcreator.workbench.panel-icon` slot render) shows
a blue dot in its top-right corner while the session has produced files the
user has not looked at yet. A per-session seen watermark (presentation-only,
persisted in localStorage) advances only while the panel group is visible —
hidden groups stay mounted, so a hidden panel keeps its dot until opened.

## Renderer architecture

### Key space

`deepcreator.workbench.artifact.renderer` stays the single keyed Slot. The
key space becomes two-segment with a fixed resolution order:

1. `mime:<exact>` — e.g. `mime:image/svg+xml`
2. `mime:<type>/*` — e.g. `mime:text/*`
3. `<kind>` — derived from the path extension in phase 2
4. built-in text fallback (`<pre>` with ReadBlock styling)

Slot resolution runs in the Artifact feature package (the slot consumer), so
third parties keep registering keyed renderers into the same open space with
no central switch. Unresolved keys fall through to the fallback with a visible
"no renderer for `<kind>/<mime>`" affordance — an explicit state, not a blank.

### Renderer ownership (phase 2)

| Kind / mime | Renderer | Owner |
|---|---|---|
| `plan`, `document`, `report`, `mime:text/markdown` | `MarkdownText` | artifact package assembles from ui-primitives |
| `code`, `mime:text/*` source files | `CodeBlock` (syntax-aware, code-theme registry) | artifact package assembles |
| JSON (`mime:application/json`, `.json` path) | `JsonBlock` | artifact package assembles |
| `image` + `mime:image/*` | binary read (phase 2) | artifact package |
| `mime:text/html`, `mime:image/svg+xml` | sandboxed preview (phase 3) | artifact package |

ui-primitives stays business-state-free; the artifact package owns only
assembly and the truncation/notice UX. If a renderer becomes shared by another
domain later, it graduates to ui-primitives at that point, not before.

### Binary content (phase 2)

`remote.artifacts` gains `readBlob(sessionId, path)` returning
`{ ok: true, mime, data: base64 }` for image mimes and workspace-path
locators, with the same sandbox checks and a `maxReadBlobBytes` Config cap.
No data-URL smuggling through `read`.

### Untrusted content rules

- Artifact paths render as plain text, never as markdown.
- Markdown/code/JSON render through the shared ui-primitives renderers already
  hardened for untrusted model output.
- HTML/SVG preview (phase 3) renders in `<iframe sandbox srcdoc>` with
  **no** `allow-scripts`, `allow-same-origin` off, and a restrictive CSP —
  strictly stricter than the Browser panel's loopback policy, because artifact
  files are arbitrary workspace content, not a navigated origin. This is a
  product security decision recorded here; enabling script execution requires
  a new design review.

## Package boundaries

Client package `packages/client/ui-workbench-artifact`
(`@ryanyujazz/dsh-client-ui-workbench-artifact`):

- Owns: the `artifact` panel registration, the turn projection + `artifacts`
  view builder, the type entry icon with the new-artifact dot, renderer
  assembly, truncation UX, locale dictionaries (`workbench-artifact`
  namespace), tab-label and row view models.
- Depends on: `ui-workbench` (contract), `ui-primitives`, `locale`,
  `workbench-remotes` (mounted remote namespace), `dsh-tools` (call-view
  types), `dsh-artifacts` (read remote types). Does **not** depend on xterm or
  any terminal/review code.

Host package `packages/host/artifacts` (`@ryanyujazz/dsh-artifacts`) is a
read-only workspace file reader (one Typert Remote `read`); no registry, no
events, no fold.

`ui-workbench-tools` retains Review and Terminal; Browser presentation is owned by `ui-browser`. Bundle changes ride
the existing `deepcreator-web` patch (`deepcreator-workbench-artifact` Client
row + `deepcreator-artifacts` Host row; the former `deepcreator-tool-artifact`
row is removed).

## UX specification

- **Tab labels**: `contributePanelInfo.tabLabels` maps instance path → file
  basename (duplicates get a counter, following the terminal project-name
  pattern).
- **List (home route)**: rows carry basename, full path, and relative time;
  sorted by production time desc. Selecting a row opens its instance tab.
- **New-artifact dot**: the type entry icon shows a blue dot while unviewed
  produced files exist (see above).
- **Empty states**: no artifacts (explain what produces them), read failure
  per error code. All copy through the locale namespace.
- **Typography** follows `UI_STYLE_GUIDE.md`; the guide is updated in the same
  change as any new badge/notice style.

## Session lifecycle and persistence

- Produced paths live and die with the session log; no Client-side durable
  artifact store exists or is added. Workbench tab/route persistence already
  covers the panel's presentation state (`dsh.deepcreator.workbench.session.v2`).
- Hidden groups stay mounted, so a hidden Artifact panel keeps its projection
  warm; this falls out of existing Workbench behavior, with no artifact-specific
  lifecycle code.

## Phasing

- **Phase 1 — closed loop (implemented)**: turn projection mirroring the
  official deliverables derivation; live list; basename tab labels; the
  new-artifact dot; read-only Host file reader. Renderer stays the text
  fallback.
- **Phase 2 — rendering quality and classification**: markdown/code/JSON
  renderers with the two-segment key space; kind derivation from paths;
  truncation Config + notice; `readBlob` and image rendering; list groups
  (分类) on the home route.
- **Phase 3 — discoverability and depth**: conversation artifact cards;
  revision timeline (the log already holds full history); HTML/SVG sandboxed
  preview.

## Verification plan (per phase)

- Unit: node match/update determinism and replay, snapshot builder fold
  (one record per path, newest first), tab-label dedup, key-space resolution
  order, truncation flag, badge watermark behavior, Host reader sandbox.
- `pnpm --filter` typecheck/test/bundle for every touched package, then the
  repository set; `dump-config` for changed rows (one owner per id, dependency
  closure); real browser smoke: model writes a file → panel updates without
  refresh → the entry icon shows the dot → open → render; opening the panel
  clears the dot; disposal check (unload plugin, remount).
- No profile migration or `$DSH_HOME` mutation for pure Client/unit work; the
  Host rows are exercised through the managed profile only when the bundle
  patch changes.
