# @ryanyujazz/dsh-browser-playwright

Concrete managed Playwright Providers for Chromium, Firefox, and WebKit. The package contributes semantic Browser commands and the root-Agent `playwright_run` advanced tool. Browser Core retains logical ids, leases, selection, presentation state, and cleanup.

Real Playwright objects live in a DSH-subprocess-managed Owner process. `playwright_run` transpiles JavaScript/TypeScript with ESBuild and evaluates it inside QuickJS/WASM, using single-run proxy handles and callback/event/error/cancellation transport. The isolate has no Node globals, module loader, filesystem, process, or socket access. Controlled mode gates opaque execution and risky actions; trusted mode is explicit per-call approval and still does not grant Node authority.

The package pins `playwright-core` exactly and generates `lib/playwright-api-manifest.json` from its official type declaration at build time. Inputs use `await workspace.file()`, output files use `await artifacts.output()`, and output directories use `await artifacts.directory()`; unbrokered paths are rejected. Pages created inside scripts are adopted into Browser Runtime as Provider-correct logical tabs.
