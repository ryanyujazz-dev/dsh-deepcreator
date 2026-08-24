# @ryanyujazz/dsh-browser-playwright

Concrete managed Playwright Providers for Chromium, Firefox, and WebKit. The package contributes semantic Browser commands and the root-Agent `playwright_run` advanced tool. Browser Core retains logical ids, leases, selection, presentation state, and cleanup.

Real Playwright objects live in a DSH-subprocess-managed Owner process. `playwright_run` transpiles JavaScript/TypeScript with ESBuild and evaluates it inside QuickJS/WASM, using single-run proxy handles and callback/event/error/cancellation transport. The isolate has no Node globals, module loader, filesystem, process, or socket access. Controlled mode gates opaque execution and risky actions; trusted mode is explicit per-call approval and still does not grant Node authority.

Every Playwright proxy method must be awaited, including native-sync methods such as `page.url()` and `response.status()`. A final callback or unresolved proxy fails with actionable guidance. Teardown waits for Host calls, drains pending jobs, clears callbacks/tokens/handles, then disposes QuickJS; teardown failure becomes `PLAYWRIGHT_ISOLATE_CRASHED`. The Owner restarts on the next call, old tabs become `owner-restarted`, and two consecutive crashes circuit-break the current Turn.

Trusted mode approves opaque capability once per invocation; click/fill/post and other real external side effects retain their own approval. Output budgets are 20,000 characters per string, 100 array items, 10 levels, and 64 KiB final JSON with warnings. Desktop proxy environment is converted into explicit Context proxy settings, including `NO_PROXY` and loopback bypass.

The package pins `playwright-core` exactly and generates `lib/playwright-api-manifest.json` from its official type declaration at build time. Inputs use `await workspace.file()`, output files use `await artifacts.output()`, and output directories use `await artifacts.directory()`; unbrokered paths are rejected. Pages created inside scripts are adopted into Browser Runtime as Provider-correct logical tabs.
