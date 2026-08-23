# DeepCreator Browser Use

Browser Use is a Host capability with an optional presentation. It is not an Electron panel feature and it is not an MCP server. The production path has four independent layers:

```text
browser_* tools ──> BrowserRuntime ──> BrowserProvider
                           │          ├─ Managed Playwright (Chromium/Firefox/WebKit)
                           │          ├─ IAB (private Desktop RPC)
                           │          └─ system Chrome (Extension + Native Messaging)

playwright_run ──> approval/policy Broker ──> DSH-managed Playwright Owner process
                                                     └─ QuickJS script isolate + real Playwright objects

open_in_deepcreator ──> PresentationRuntime ──> claimed PresentationProvider
       ▲                    ▲                         ├─ Browser UI adapter
       │                    └─ resource resolvers     ├─ Artifact UI adapter
       └─ independent root-Agent tool                 └─ Review UI adapter
```

The previous `browser-mcp -> CDP port -> Session Projection -> Workbench watcher` prototype is retired. Browser state is not reconstructed from Session events, tool names, URLs, or CDP target order.

## Ownership and identities

`BrowserRuntime` is the single source of truth for Provider registration, logical tabs, selected tab, state revision, snapshot validity, leases, and turn cleanup.

- `browserId` identifies a registered Provider instance.
- `automationSessionId` identifies one Agent/turn control lease.
- `tabId` is a Host-generated Provider-independent logical identity exposed to tools and clients.
- `providerTabId` is private to a Provider.
- `surfaceId` binds one presentable surface to exactly one logical tab.
- `snapshotId + nodeRef` identifies an element only in one structured snapshot.

URLs are mutable data, never identity. Browser tab, lease, surface, loading, and snapshot state is process-local and intentionally absent from Session Projection. Normal tool calls, results, `open_in_deepcreator` receipts, and approvals remain in the ordinary Session log.

## Agent API

The Browser Host registers six Browser ToolDefinitions only on root Agents. The independent Presentation Host registers `open_in_deepcreator` on the same root-Agent boundary:

| Tool | Responsibility |
|---|---|
| `browser_list` | Resolve Providers by automation, visibility, interaction, profile, family, and namespaced capabilities; explain every candidate mismatch. |
| `browser_tabs` | List, create, share/claim, show, hand off, resume, close, or mark tab lifecycle. |
| `browser_navigate` | Go to a URL, back, forward, or reload. |
| `browser_inspect` | Read state, create a structured snapshot, inspect an element, or store a screenshot artifact. |
| `browser_act` | Perform one semantic action, with approval before classified side effects. |
| `browser_wait` | Wait for concrete URL, load, element, or dialog conditions. |
| `playwright_run` | Run advanced JS/TS against the Playwright Library API in a QuickJS isolate backed by an independent Owner process. |
| `open_in_deepcreator` | Materialize and present a URL, Browser tab, artifact, review, or future resolver contribution. |

Native agents invoke these definitions directly. Code/PTC receives the same definitions through DSH's existing typed `tools.browser_*` SDK generation and `run_code` dispatch. Subagents do not inherit them.

`open_in_deepcreator` uses a stable envelope whose `input` is an exact-one union assembled from registered resolver schemas, for example `{input:{kind:"url",url:"http://localhost:3000"}}`. Native and Code/PTC therefore receive the same resource-specific generated types without Presentation Core importing Browser, Artifact, or Review.

An explicit `browserId`, family, or engine never falls back. Automatic selection matches a `BrowserRequirements` vector: `automation`, `visibility`, `interaction`, `profile`, and namespaced capabilities. Ordinary background work selects Managed Playwright Chromium. Live work follows the persisted Provider order (initially IAB → Chrome → headed Playwright). User-profile/shared-tab work selects Chrome; `automation.playwright` never selects IAB or Chrome. A live IAB tab returns `nextAction: open-in-deepcreator` and cannot execute until the exact `tabId` receives a presentation receipt. Chrome and headed Playwright own their visible windows, so their `nextAction` is ready. A URL materialized as a managed snapshot is screenshotted before the Presenter receipt and becomes a deliverable after successful presentation, so its panel is neither blank nor invalidated at turn end.

## Provider contract

`BrowserProvider` exposes descriptors, tab creation/list/claim, semantic command execution, release, close, and optional disposal. Core conformance capabilities are tabs, navigation, structured snapshot, screenshot, semantic actions, and waits. Upload, download, user tabs, manual takeover, and live surfaces remain explicit optional capabilities.

`runBrowserProviderConformance()` is shipped with `@ryanyujazz/dsh-browser` so a future extension Provider can validate descriptor stability, tab visibility, snapshot versioning, and cleanup without importing Runtime internals.

### Managed Playwright

`@ryanyujazz/dsh-browser-playwright` contributes Chromium, Firefox, and WebKit descriptors. Ordinary semantic work uses a dedicated persistent managed Profile; `playwright_run target:new` defaults to an isolated temporary Context. Headed mode creates a managed visible window and never impersonates the user's Chrome Profile. Executable resolution is deterministic: configured executable, the exact-version Browser Pack, then a supported system Chromium. Runtime never downloads a browser; an absent engine is listed as unavailable with an actionable diagnostic.

The real Playwright Browser/Context/Page/Handle graph lives in one DSH-subprocess-managed Owner process. The Host communicates by framed RPC and owns policy/approval decisions; tree-scoped termination drains the Owner on plugin teardown. Agent code is ESBuild-transpiled and evaluated in QuickJS/WASM. Its Playwright objects are single-run proxy handles with callback, event, RegExp, byte, error, cancellation, and Promise transport. It has no Node globals, imports, filesystem, child process, or socket. The exact `playwright-core` version generates a build-time API manifest so CI detects type drift instead of maintaining a handwritten method subset.

Controlled mode blocks opaque evaluation, raw CDP, init scripts, BrowserServer/connect, and BrowserType launch. Trusted mode requires approval for that call, then enables those browser APIs without adding Node authority. Page mutations still require action-time approval. Workspace inputs and artifact outputs use opaque broker tokens; absolute/unbrokered paths, traversal, symlink escape, executable paths, and download/video path disclosure fail closed. New Pages—including callback/popup Pages and Pages created with another Playwright engine—are adopted back into the correct Provider as logical `tabId` values.

### IAB

Electron Main owns the persistent `persist:deepcreator-browser-iab-v1` partition, every `WebContentsView`, download handling, user input, and debugger session. The app renderer receives only four geometry methods:

```ts
mount(surfaceId, bounds)
setBounds(surfaceId, bounds)
setVisible(surfaceId, visible)
unmount(surfaceId)
```

Renderer code cannot create/navigate pages, read DOM, send debugger commands, or access files. Host and Main communicate over an owner-only Unix socket or Windows named pipe with a random 256-bit token. There is no Electron remote-debugging port. Pointer or keyboard input inside the page emits `CONTROL_INTERRUPTED` for the exact surface; panel hide/unmount does not close the page or revoke the tab by itself.

General settings contributes an explicit, confirmed “Clear Browser data” operation. It closes managed tabs and clears both isolated Provider Profiles without touching personal Chrome.

### System Chrome

`@ryanyujazz/dsh-browser-chrome` is an actual Desktop Provider, not a contract placeholder. Its fixed-ID Manifest V3 extension connects through a user-installed Native Messaging host to an owner-only, token-authenticated Browser Host endpoint. macOS/Linux use user-level Native Messaging manifests; Windows uses HKCU. Installation, repair, upgrade, and uninstall are explicit exported operations and never run during Provider startup.

Clicking the extension action shares or unshares only the active tab. Runtime cannot enumerate other private tabs. Claim validates the latest `providerTabId + title + url + revision`. Agent-created tabs are visible in Chrome; Chrome owns focus and does not call `open_in_deepcreator`. A DeepCreator Presenter may separately show a read-only snapshot.

Chrome semantic automation uses `chrome.debugger`, `tabs`, and `scripting` inside the extension without a remote-debugging port. Fetch interception pauses every HTTP(S) request and redirect until Host reruns protocol, DNS, loopback/private-network, link-local, and metadata policy. A five-second missing decision fails closed. Trusted pointer, key, or beforeinput events interrupt the exact logical tab. Chrome declares only implemented capabilities and deliberately does not claim `automation.playwright` or managed download artifacts.

## Presentation contract and UI replacement

`@ryanyujazz/dsh-presentation` owns the resource resolver registry, `PresentationRuntime`, the `open_in_deepcreator` tool, deadlines, claims, receipts, and dismissal tombstones. It has no Browser dependency and can be composed with Artifact, Review, or future resources in deployments that do not include Browser Runtime. Browser contributes only `url` and `browser-tab` resolvers; Artifact and Review contribute their own resolvers.

Every client advertises exact `(resourceKind, modes, surfaceHost)` capabilities under a stable `clientId`. Host filters pending requests, grants one atomic claim, and accepts acknowledgement only from that claimant. A Web snapshot client therefore cannot consume a Desktop live-IAB request, and a late or wrong-client receipt cannot unlock Browser control. One Host deadline is carried in the request; live surface mounting uses only the remaining budget (capped below the Host deadline), eliminating equal-timeout races.

Failures are structured as `code`, `stage`, `retryable`, and `message`. Codes distinguish no capable client, no presenter, panel render timeout, missing native bridge, native mount rejection/timeout/destruction, presenter exception, receipt timeout, disconnect, resolver absence, and materialization failure. `presented` exclusively means the Browser panel committed the exact logical tab and its native Surface completed mount and visibility acknowledgement; a Workbench shell or loaded Provider page is insufficient. It is never reused for “headless is controllable”. A newly materialized URL tab—and any fresh temporary live IAB tab that never became visible—is rolled back when presentation does not complete, so callers cannot continue against a half-success tab.

A dismissal tombstone is keyed by session, turn, and canonical resource. Once the user hides a presented resource, repeated presentation in that turn returns `suppressed`; hiding or unmounting presentation does not itself close an already-owned Browser tab. Closing an individual Browser instance is a different, explicit lifecycle command: the Client calls the agent-fenced Browser `closeTab` Remote, which drains the exact tab, closes its Provider page, removes its logical identity, and bumps Browser state. Non-retryable presentation failures are separately tombstoned by session, turn, and canonical tool input before any repeat materialization, so an Agent cannot create duplicate tabs or repeatedly churn the same broken panel. Both tombstone classes expire at turn end.

The React-free `@ryanyujazz/dsh-client-presentation` package owns the claim loop and `PresentationProviderRegistry`. `BrowserClientRuntime` now consumes Browser state only. Browser, Artifact, and Review UI packages independently register their default Workbench presenters. `typeId: "browser"` remains only inside the Browser Workbench adapter for layout compatibility.

To replace the right panel with a floating window or another shell:

```ts
const dispose = presentation.providers.register({
  id: 'floating-browser',
  priority: 200,
  resourceKinds: ['browser-tab'],
  modes: ['live', 'snapshot'],
  surfaceHost: true,
  async present(request, resource) {
    floatingUi.open(resource.id)
    return {
      status: 'presented',
      presenterId: 'floating-browser',
    }
  },
  dismiss: key => floatingUi.close(key),
})
```

For live IAB content the UI additionally supplies a `BrowserSurfaceBridge`; snapshot Providers need only render URL, state, action history, and the latest event-driven screenshot. Screenshot bytes live in Browser artifacts and are fetched through a separate agent-fenced preview Remote keyed by `snapshotArtifactId`; the atomic Browser state snapshot never carries multi-megabyte image data. Preview hydration publishes independently of Host revision, reports fetch errors instead of presenting them as “not yet captured”, and uses bounded automatic plus explicit retries. Replacing the Presenter changes no Agent tool, Host Runtime, Browser Provider, network policy, or approval rule.

The Workbench adapter sends the panel-body rectangle when mounting a Surface and measures it again after the asynchronous native mount resolves. Subsequent element resize notifications update the exact same `surfaceId`, so Electron's WebContents viewport tracks the panel width instead of retaining a pre-layout rectangle. Bounds are expressed in renderer CSS pixels/Electron DIPs; the page receives a real narrower viewport and reflows normally rather than being visually transformed.

## Lifecycle

- An Agent-created tab starts `temporary`. An unpresented live tab and an ordinary temporary background tab close at turn end.
- An exactly presented live IAB tab, a system Chrome tab, or a headed Playwright tab is automatically promoted to `deliverable` and remains open after the Agent turn, because it has become a user-visible result.
- A claimed user tab is released and remains open.
- `markDeliverable` preserves a result for the user.
- `markHandoff` preserves one next-turn continuation and resets to temporary.
- Agent/Host teardown drains commands and releases all Provider resources.
- Hiding the Browser Group retains its tabs; closing one Browser instance immediately closes the exact Provider page and invalidates its `tabId`.
- Restored Session logs never fabricate old tabs; stale ids return `TAB_NOT_FOUND`.

## Security

Navigation allows HTTP(S), public addresses, and loopback development endpoints. It rejects file/data/javascript schemes, link-local and metadata endpoints, and non-loopback private networks unless deployment policy opts in. Providers reapply the policy to requests and redirects.

Page content, DOM, screenshots, downloads, redirects, and dialogs are untrusted. Read, navigation, screenshot, wait, and scroll are direct. Submission, sending, publication, purchase, deletion, permission changes, upload, or sensitive transfer requests a one-time DSH approval before mutation. Password, OTP, payment, cookie, and token entry is manual shielded handoff in IAB or a shared Chrome tab. Non-idempotent actions are never automatically replayed.

IAB and Managed Playwright execute the same Provider-neutral structured-snapshot script; the Chrome extension carries the same extraction rules inside its MV3 worker. They exclude hidden, inert, `aria-hidden`, non-rendered, and zero-area controls; expose values only for ordinary visible editable fields; and omit values for password, OTP, payment, token, secret, session, signature, and related identities. At the model/log boundary, every returned `url` is copied through query redaction: useful search terms remain, while credential-like keys, nested redirect URLs, fragments, and oversized opaque payloads are replaced. Provider and UI state retain the exact URL needed for navigation without serializing it into the Session tool result.

Stable error codes are `BROWSER_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `CAPABILITY_UNSUPPORTED`, `TAB_NOT_FOUND`, `TAB_NOT_OWNED`, `STALE_SNAPSHOT`, `CONTROL_INTERRUPTED`, `NAVIGATION_BLOCKED`, `APPROVAL_DENIED`, `AUTH_REQUIRED`, `TIMEOUT`, `PAGE_CRASHED`, `PRESENTATION_UNAVAILABLE`, and `PROFILE_LOCKED`.

## Package boundaries

- `packages/host/presentation`: generic resolver registry, root-Agent presentation tool, client claims, deadlines, receipts, and dismissal lifecycle.
- `packages/host/browser`: Provider-neutral Runtime, contracts, six semantic tools, resolver contributions, network/path/approval policy, logical tabs, and cleanup. It imports no Playwright, Electron, Chrome, or React.
- `packages/host/browser-playwright`: three Managed Providers, DSH-managed Owner process, QuickJS/Playwright wire, `playwright_run`, pinned API manifest, and Playwright skill.
- `packages/host/browser-iab`: private Desktop RPC Provider adapter; Electron implementation remains in `apps/desktop`.
- `packages/host/browser-chrome`: Chrome Provider, authenticated bridge, explicit three-platform Native Host installer, and fixed-ID MV3 extension.
- `apps/desktop`: private RPC server and Electron Main Surface driver.
- `packages/client/presentation`: React-free client capability/claim loop and Presenter registry.
- `packages/client/ui-browser`: Browser client state store, Surface host, and Browser Workbench Presenter.
- `packages/client/ui-workbench-artifact` / `ui-workbench-tools`: Artifact and Review Presenter contributions.
- `packages/client/workbench-remotes`: generated Presentation and domain Remote mounts only.
- `packages/client/ui-workbench`: generic panel topology plus explicit dismissal notification.
- `packages/bundle/deepcreator-web`: independent Presentation Host/Client rows plus optional resource runtimes and UI adapters.

The obsolete Browser MCP package, global CDP switch, tool-name watcher, and Browser Session Projection are intentionally not composed or shipped.
