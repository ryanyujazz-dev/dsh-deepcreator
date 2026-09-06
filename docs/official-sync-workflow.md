# Official upstream sync workflow

Operational workflow for folding official DeepSeek Harness releases into this
fork. The recorded sync baseline lives in
`packages/client/compat/compatibility.json` (`harnessVersion` +
`harnessGitSha`); that SHA is **O_old**. Everything below was proven on the
0.1.1-rc.2 → 0.1.2-rc.1 sync (PR #27/#28/#29) and the follow-up UX ports
(#30/#31).

## 0. Ground rules

- **Network**: every `git fetch/push`, `gh`, and `pnpm install` runs behind the
  local proxy — `export https_proxy=http://127.0.0.1:7890 http_proxy=http://127.0.0.1:7890`.
- **Remotes**: `official` = deepseek-ai/deepseek-harness, `origin` = this fork.
- **The fork has no git ancestry with official** — sync is copy/merge based,
  driven by three-way comparison (disk vs `HEAD` vs `O_old`/`O_new`).
- The app serves `lib/client.js`, never `src`. **Any package whose `src/`
  changed must be re-bundled** (`pnpm --filter <pkg> bundle`, or a full
  `pnpm build`) before browser/desktop validation — a source fix without a
  bundle rebuild is invisible at runtime, and a stale `lib/` can shadow source
  fixes in downstream typecheck too.

## 1. Scope model (which packages, which import scope)

| Class | Packages | Import scope |
| --- | --- | --- |
| Vendored client (16) | locale, ui-agent-preset, ui-conversation, ui-layout, ui-model-selection, ui-permission-presets, ui-primitives, ui-settings, ui-settings-general, ui-sidebar, ui-subagent, ui-theme, ui-tool, ui-trajectory, ui-user-questions, ui-workspace | `@ryanyujazz/dsh-client-X` + `workspace:^`; tsconfig.test.json maps them to local `src/` |
| Fork-only | compat, presentation, workbench family, browser family, host workbench packages (terminal-workbench, …) | fork-owned |
| npm-only | everything else official ships (`dsh-client-store`, `dsh-client-ui-chat`, `dsh-api-session-controller`, `dsh-client-ui-settings`, …) | `@deepseek-ai/X` pinned to the synced release |

Hard scope rules:

- `ui-settings` machinery types stay on the **npm** package — the fork's local
  `ui-settings` is deliberately reduced.
- Some fork source files deliberately import official **type names**
  (`AssistantBlock`, `ConversationLocation`, …) from the npm
  `@deepseek-ai/dsh-client-ui-conversation/client` while consuming local
  runtime through `@ryanyujazz` — do not "fix" those imports during a sweep.
- Vendored-package **tests** that official wrote importing their own package
  (`@deepseek-ai/dsh-client-<self>`) must be rewritten to the `@ryanyujazz`
  scope; official tests importing npm-only machinery by `src/` path
  (`SettingsSchemaService`, `SettingsDescribeMirror` from
  `@deepseek-ai/dsh-client-ui-settings/src/...`) get a narrow fixture double in
  that package's `tests/` instead (see
  `ui-permission-presets/tests/describe-mirror.fixture.ts`).

## 2. Quantify the delta

```sh
O_OLD=$(python3 -c "import json;print(json.load(open('packages/client/compat/compatibility.json'))['harnessGitSha'])")
git fetch official --tags          # behind the proxy
O_NEW=<new official release SHA>
git diff --name-status $O_OLD $O_NEW -- packages/client/<pkg>   # per vendored package
```

Classify every changed file into **copy** (official-new, or official-only
file), **merge** (both sides moved), **delete** (official removed and nothing
fork-side needs it), and **leave** (fork-owned).

## 3. Per-file lineage + fork-keeper disposition

For merge files, classify disk vs `HEAD` vs `O_OLD`:

- **FORK** (disk ≈ HEAD, diverged from official) — fork wins wholesale unless
  the delta is a small graftable feature.
- **OFFICIAL** (disk ≈ official) — take official.
- **FRANKEN** (between) — decide per subsystem using the fork-keeper map
  below; never leave a franken file.

Fork-keeper map (what fork owns vs what official owns):

- **Fork wins wholesale**: ui-conversation input/chat core (textarea composer
  + decoration system, skeleton, facade), ui-workspace browsing, ui-settings +
  settings-general core, ui-agent-preset seats (`SeatSessionSummary`
  contract), ui-tool toolviews, ui-user-questions, ui-model-selection trigger
  (brain icon, mount-time load), ui-layout presenter (code-theme attribute,
  Windows titlebar, phone layout), ui-skills, fork primitives' markdown
  highlight engine (deepcreator dual-theme shiki vars) and Menu/Modal/terminal
  surfaces.
- **Official wins**: locale dictionaries (official key sets supersede; re-add
  fork-only keys afterwards), trajectory core (table/virtual rows), primitives
  additive files (hooks, ReferenceIcon, relative-time, user-text, …), official
  UX grafts listed below.
- **True hybrids** (fork base + grafted official feature): ui-theme (fork rich
  theme + official fontSize axis + rc.1 `webserver/index-inject` boot), theme
  presenter (fork code-theme attr + `--dsh-content-font-size` axis),
  ui-conversation (fork core + merged locales + official-derived
  chat-snapshot-builder conversation-nodes), ContextMeter (fork + official
  compact-number templates).
- **Graft library** (official features already ported — re-verify, don't
  re-port): transcript width drag (ConversationRoot WidthHandle + localStorage
  `dsh.conversation.contentWidth`), TurnNavigator rail
  (`ui-conversation/src/client/chat/TurnNavigator.tsx` + `use-turn-rail.ts`,
  fed by the chat snapshot's navigation index + host `turnOutline`
  projection), session-aware DocumentTitle, running-state primary button
  (`primaryStops = running && subagent === null && (empty || blocked)`),
  PermissionSelect preset labels via `access.preset.*`, queue image
  thumbnails, details drag pill, agent-preset refusal toast, model-select
  loading trigger.

## 4. Merge mechanics

- **Locales**: take official's dictionary as the base (it is the i18n source
  of truth), then re-inject every fork-only key from `HEAD`. Update the
  locale-key union automatically (`keyof typeof zh`) and keep `en` complete
  against the zh key set. zh copy like `默认`/`完全权限` follows official.
- **package.json**: merge deltas — official wins for shared dependencies, but
  **audit for fork-only deps official lacks** (the "lost deps" class: re-add
  from `HEAD` or the app breaks at link time). `tsconfig.json`, `tsdown`
  config, and `README*` stay fork.
- **Host plugin graph**: before adding any plugin row to
  `packages/bundle/deepcreator-web/cordis.patch.yml`, check whether the
  official base profile already ships it (`session-stats`,
  `session-turn-outline`, …). Re-registering an existing id dies at boot with
  `duplicate loader entry id` and no window opens. Only add what the base
  lacks.
- **Scope hygiene sweeps** after bulk copies:
  - ghost `@ryanyujazz/*` names that match no workspace package → back to
    `@deepseek-ai/*`;
  - `@ryanyujazz/dsh-client-ui-slots`, `dsh-client-store`,
    `dsh-client-test-runtime`, `dsh-browser-mcp` in non-vendored surfaces →
    back to `@deepseek-ai`;
  - vendored-package official tests' self-imports → `@ryanyujazz`.
- **CSS**: official repo-wide style lints (`corner-shape`, `elevation`, 0.5px
  hairlines) conflict with fork-kept CSS by design — drop those lint tests
  with the divergence rather than porting the restyle wholesale. Keep official
  hairline deltas only where the file is otherwise official (e.g. trajectory).

## 5. Test alignment

- Pick the test base that matches the src disposition (fork src → HEAD tests;
  official src → official tests, scope-rewritten).
- Expectation updates for merged reality: zh dictionary copy (预设 labels,
  `默认`), official behavior changes (running-state primary button), and
  localized unit assertions are legitimate test edits — semantic drift is not.
- Watch for merge-damaged `import { … } from 'vitest'` lines (dropped
  `beforeEach`/`afterEach` names) — tsc only fails at runtime as
  `ReferenceError`.
- npm-only machinery doubles: keep them narrow and faithful to the npm
  package's declared semantics (mirror snapshot shape, higher-seq-wins, …).

## 6. Verification ladder (all green or it is not done)

```sh
pnpm install                                  # proxy; postinstall re-arms node-pty
pnpm -r --no-bail --if-present typecheck      # 43/43 packages
npx vitest run                                # full suite
node scripts/verify-harness/index.mjs         # pins harnessVersion + SHA
pnpm build                                    # all 43 bundles — covers the bundle rule
pnpm --filter @ryanyujazz/dsh-deepcreator-desktop bundle
```

Operational notes:

- tsc suppresses the semantic pass while any **syntax** error exists — fix
  syntax first or the error list lies about scale.
- After changing a package's exported types, rebuild its bundle before
  judging downstream packages' errors (stale `lib/` shadows source fixes).
- If the terminal panel dies with `posix_spawnp failed`, node-pty's prebuilt
  `spawn-helper` lost its exec bit: `node scripts/fix-node-pty.mjs` (also runs
  on every `pnpm install`).

**CDP live smoke** (Chinese mode) — launch
`cd apps/desktop && pnpm exec electron . --remote-debugging-port=9223`, then
via CDP: UI is zh (新会话/设置), a tool session shows 读取/编辑 rows and the
aggregated exec row, 深度求索中 appears live while a prompt runs, the
trajectory tab shows 时长/轮次/调用, the turn rail renders 跳转到第 N 轮 for
multi-turn sessions, and the terminal panel spawns a shell in the workspace
cwd.

## 7. Commit, review, merge

- One branch per arc (`feat/sync-official-…`, `fix/…`); the sync commit
  updates `compatibility.json` to `O_NEW`.
- Review checklist: debris scan (`.DS_Store`/logs/pngs/`*.orig`), conflict
  markers, `patches/` ↔ `pnpm-workspace.yaml` patchedDependencies consistency,
  no duplicate plugin ids in `cordis.patch.yml`, final typecheck + vitest on
  the exact merge candidate.
- Stacked PRs merge in dependency order (each later branch contains the
  earlier as ancestor — merge #27 → #28 → #29 style).
- Push and `gh` behind the proxy.

## 8. Post-merge

- `git checkout main && git pull` — note that checkout/pull rewrites file
  mtimes; an mtime-based "stale bundle" scan will false-positive. Rebuild with
  content knowledge (which packages you actually edited) or just run
  `pnpm build`.
- Restart the desktop app to pick up fresh `lib/` bundles.
