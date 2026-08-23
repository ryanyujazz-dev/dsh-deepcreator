# @ryanyujazz/dsh-browser

Provider-neutral Browser Runtime, capability selection, logical tabs/leases, six root-Agent semantic tools, URL/browser-tab Presentation resolvers, network/path/approval policy, and Typert Remote for DeepCreator.

The public boundary exposes logical Browser identities and semantic commands only. Providers keep Playwright, Electron, debugger, extension, and native handles private. Live state is process-local; ordinary tool calls/results and approvals use DSH's existing Session log.

Concrete Providers live in independently disposable packages:

- `@ryanyujazz/dsh-browser-playwright`: Managed Chromium, Firefox, and WebKit plus `playwright_run`.
- `@ryanyujazz/dsh-browser-iab`: Electron IAB over authenticated private IPC and exact Surface identity.
- `@ryanyujazz/dsh-browser-chrome`: system Chrome extension and Native Messaging Provider.

Core imports none of Playwright, Electron, Chrome, React, or the current panel implementation. Playwright is an automation capability, not a synonym for a Browser placement. Deterministic selection matches automation, visibility, interaction, profile, family, and namespaced capabilities. Explicit Provider/family/engine requests never fall back.

`open_in_deepcreator` is owned by independent `@ryanyujazz/dsh-presentation`; this package contributes only `url` and `browser-tab` resolvers. The current Workbench panel is only a client Presenter and can be replaced without changing this package. See [Browser Use architecture](../../../docs/architecture/browser-use.md).

If a fresh temporary live IAB tab cannot be presented, its resolver closes it immediately. Structured snapshots share one Provider-neutral visibility/redaction script: hidden controls and secret/token fields are excluded, while model-facing URL copies redact sensitive and opaque query values. Exact URLs remain inside Provider/UI state rather than entering tool results and Session logs.

A temporary live IAB tab becomes `deliverable` only after an exact Surface presentation acknowledgement. Provider-owned live Chrome/headed-Playwright tabs are deliverables when shown. Unpresented live tabs and ordinary temporary background tabs close at turn end.

The agent-fenced `browser/closeTab` Remote is the user-interface lifecycle boundary: closing a Browser instance drains its queued command, invokes the owning Provider's `close`, deletes the logical tab, and bumps the Browser state revision. Destruction is idempotent because Workbench dismissal and direct resource close may converge on the same `tabId`; an already-absent tab is the desired state, while attempting to close another session's live tab still fails. Hiding or unmounting a Presenter remains presentation-only and never calls this operation.

Explicit Browser-panel actions use two additional agent-fenced Remotes without weakening the Provider boundary. `browser/newTab` creates a deliverable blank `iab` tab under a client-only synthetic turn; the client must still present its returned logical `tabId` through `@ryanyujazz/dsh-presentation`. `browser/navigateTab` applies the same Host network policy and Provider queue as Agent navigation, but records an input interruption and leaves control with the user. Neither Remote exposes Electron, WebContents, CDP, or Provider handles.
