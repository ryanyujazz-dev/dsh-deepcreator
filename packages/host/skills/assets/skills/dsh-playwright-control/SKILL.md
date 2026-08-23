---
name: dsh-playwright-control
description: Use DeepCreator's full Playwright Library tool for advanced browser automation, multi-engine testing, routes, events, callbacks, traces, video, downloads, request contexts, and CDP. Required reading before playwright_run.
---

# DeepCreator Playwright control

`playwright_run` is the advanced automation layer contributed by `@ryanyujazz/dsh-browser-playwright`. It is available only to root Agents when that Provider composition is installed. It is not another name for IAB: the selected logical tab is backed by a Managed Playwright Provider, while IAB and Chrome expose semantic automation but do not claim `automation.playwright`.

## Input

Choose an existing Managed Playwright tab:

```json
{"target":{"kind":"tab","tabId":"tab-..."},"code":"async ({ page }) => { return await page.title() }"}
```

Or create an isolated target:

```json
{"target":{"kind":"new","engine":"firefox","headless":true,"profile":"isolated"},"code":"async ({ page }) => { await page.goto('https://example.com'); return { title: await page.title() } }"}
```

The script must evaluate to a JavaScript or TypeScript function:

```ts
async ({ playwright, browser, context, page, workspace, artifacts }) => {
  return { value: 'JSON-compatible' }
}
```

`playwright` exposes Playwright Library BrowserType objects; the selected `browser`, `context`, and `page` are provided when applicable. `@playwright/test`, CLI execution, arbitrary npm/Node imports, Electron, and Android automation are outside this tool.

## Controlled and trusted

- `controlled` is default. Navigation, locators, frames, events, routes, requests, downloads, screenshots, traces, videos, and other inspectable APIs are brokered. Opaque page evaluation, raw CDP, init scripts, BrowserServer/connect, and BrowserType launch are rejected.
- `trusted` requires one-time approval for that call. It enables the opaque Playwright browser APIs, but still provides no `process`, `require`, dynamic import, arbitrary filesystem, child process, socket, external endpoint, custom executable, or credential export.
- Page mutations and external side effects still request action-time approval in both modes. Rejection must leave the page unchanged.

The code runs in a QuickJS/WASM isolate. Real Playwright objects live behind a handle/callback/event wire; handles expire at the end of the call. Pages created by the script are adopted into Browser Runtime and returned as stable logical `tabId` values.

Because every handle call crosses the asynchronous wire, `await` every Playwright proxy method, including Library methods that are synchronous in an ordinary in-process Playwright program such as `response.status()` or `page.url()`.

## Files and artifacts

- Input files must use `await workspace.file('relative/path')`. Absolute paths, traversal, and symlink escape are rejected.
- Output path options must use `await artifacts.output('trace','zip')`, `await artifacts.output('screenshot','png')`, etc. Raw output paths are rejected.
- Directory options such as `recordVideo.dir`, `downloadsPath`, or `tracesDir` must use `await artifacts.directory('video')`. They never accept raw directories.
- Returned binary data becomes an artifact automatically. Downloads, trace, PDF, screenshot, and video should be returned by artifact ID, never internal paths.
- Return values must be JSON-compatible. Cookies, authentication values, sensitive URL parameters, passwords, and OTPs are removed at the model/log boundary.

## Reliable usage

- Prefer events and Playwright waits to fixed sleeps.
- Keep a related sequence in one script when callbacks/routes/events must remain alive; handles do not survive another `playwright_run`.
- Inspect after side effects. Never auto-replay click, fill, upload, submit, purchase, delete, or download after an ambiguous failure.
- A new target defaults to isolated headless Context. `headless:false` creates a managed visible window; it is not the user's Chrome profile.
- If authentication requires human input, stop and select a live shielded IAB or Chrome Provider through the semantic Browser tools.

Playwright-specific errors are `PLAYWRIGHT_COMPILE_ERROR`, `PLAYWRIGHT_RUNTIME_ERROR`, and `PLAYWRIGHT_POLICY_BLOCKED`, in addition to the Browser Runtime error vocabulary.
