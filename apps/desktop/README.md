# DeepCreator Desktop

DeepCreator Desktop owns one sandboxed Electron window and one official `dsh` child process running under system Node. The child starts `--profile deepcreator --port 0`; the window accepts navigation only to the exact loopback origin printed after the Cordis tree settles. Session titles retain their text while the native window suffix is branded `DeepCreator`.

On macOS, the renderer extends through the hidden native title bar while the real red, yellow, and green traffic lights remain active at the left edge. The red light begins at x=20, aligned with the visible left edge of the New Session icon below; their centerline is y=24, exactly matching the 48px DeepCreator conversation header. The sandboxed renderer identifies the macOS Electron shell from its user agent so the expanded wordmark begins at x=89, one native-button gap after the green light. When the sidebar closes to zero width, the reopen button's 28px hit box begins at x=82, placing its centered 14px glyph on that same x=89 visible edge. The conversation header keeps 12px horizontal padding in both sidebar states; a 98px title-cluster reservation clears native chrome without moving the centered tabs. The root frame retains a narrow top drag strip. A maximized or fullscreen window hides the traffic lights, so the main process reports that state over a narrow preload bridge and the renderer drops every macOS offset (wordmark spacing, reopen seat, title-cluster reservation) back to the base geometry while it is set.

On Windows, the native title bar is hidden too, but the native minimize/maximize/close buttons stay through the Window Controls Overlay (`titleBarOverlay`, 32px to match the standard caption bar footprint). The client frame draws a themed 32px title strip above the three columns: it paints with the base palette tokens, mirrors the window title, and is the drag surface. The strip is the top-most web layer (z-index 1101, above every overlay), so all UI content — columns, the focused Workbench stage, drag handles, and portaled modals/menus — yields below it and nothing paints into the strip. The theme presenter pushes the resolved `--dsw-alias-bg-base`/`--dsw-alias-label-primary` colors over the `deepcreatorWindow.setTitleBarTheme` preload bridge after every theme change, and the main process forwards them to `win.setTitleBarOverlay` after sender and format validation - so the whole top row, including the native buttons, follows the in-app light/dark appearance setting. Linux keeps the default native frame. Their renderer content uses the same zero-width sidebar behavior with the reopen control at x=16 and a 32px closed-title reservation. Ordinary browsers share that content geometry without native-window markers.

Run `pnpm run profile:migrate` for initial setup, then use `pnpm run dev:desktop` from the repository root. Desktop launch runs `profile:ensure`, which automatically refreshes an outdated managed profile when the presentation bundle gains or retires workspace plugins.

### Parallel development and test instances

The default Desktop keeps its existing `DeepCreator DSH` Electron data directory and `~/.dsh` runtime home. A second Desktop can run concurrently when its launcher supplies a unique `DEEPCREATOR_INSTANCE_ID` plus absolute, distinct `DSH_HOME` and `DSH_AGENTS_HOME` paths:

```sh
DEEPCREATOR_INSTANCE_ID=test \
DSH_HOME="$HOME/.dsh-deepcreator-test" \
DSH_AGENTS_HOME="$HOME/.agents-deepcreator-test" \
pnpm run dev:desktop
```

The instance id must contain 1–32 lowercase letters, digits, underscores, or hyphens and begin with a letter or digit. It suffixes the Electron `userData` directory, scopes the single-instance lock, and appears in the window name (`DeepCreator [test]`). Named instances fail at startup unless both runtime roots are explicit; Chromium isolation alone must never be mistaken for isolated profiles, Sessions, settings, Skills, and Agent configuration. Each `DSH_HOME` needs its own source `web` profile before the first `profile:migrate`/`profile:ensure` run. `--port 0` remains unchanged, so every Host receives an independent dynamic loopback port.

At startup, Desktop resolves the operating system proxy/PAC route through Electron and projects it into the official Host's standard proxy environment when the deployment did not already provide one. Host plugins such as image generation therefore follow Clash and other system proxies when the app is launched from Finder, Dock, or Start Menu; explicit deployment proxy variables retain priority.

The main renderer keeps `sandbox`, `contextIsolation`, and `webSecurity` enabled and does not enable Node integration. Its window-state bridge exposes only zoom/fullscreen presentation state. The separate Browser Surface bridge exposes only mount, bounds, visibility, and unmount for an existing `surfaceId`; renderer code cannot create or navigate pages, inspect DOM, automate input, or access files. Electron Main owns IAB `WebContentsView` instances in a dedicated persistent partition and serves Host Browser commands over an owner-only Unix socket or Windows named pipe authenticated with a random process token. No remote-debugging port is opened.

Browser Surface bounds remain the real panel rectangle. Responsive pages render at 100% zoom; after navigation or panel resize, Electron Main measures root horizontal overflow and only fixed-width desktop pages receive a bounded fit zoom. This avoids a horizontal scrollbar in narrow panels without changing UA, Profile, cookies, DOM, or the renderer bridge contract.
