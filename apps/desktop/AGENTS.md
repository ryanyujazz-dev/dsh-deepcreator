# Desktop instructions

This directory owns the Electron process boundary only: application branding, BrowserWindow policy, the official DSH Host child process, and shutdown behavior.

- Always start the official CLI with `--profile deepcreator --port 0`; parse the settled loopback URL instead of choosing a fixed port.
- Run the Host under system Node. Do not run it through Electron's Node mode or import Harness internals into the renderer.
- Keep `sandbox`, `contextIsolation`, and `webSecurity` enabled and `nodeIntegration` disabled. Do not add a preload bridge unless a reviewed feature requires a narrowly typed capability.
- Permit navigation only to the exact loopback origin reported by the owned Host. Open external HTTP(S) links through the operating system and deny all other popup or navigation targets.
- Treat process startup, stderr, unexpected exit, application quit, and forced teardown as one tested lifecycle. Terminate only the child process owned by this Desktop instance.
- Desktop must not own Session, Workspace, Agent, settings, or UI feature state; those remain official Runtime or Client-plugin concerns.
- Add or update lifecycle tests for launcher resolution, readiness parsing, failure, navigation, or shutdown changes. Run `pnpm --filter @ryanyujazz/dsh-deepcreator-desktop typecheck` and its tests before a live smoke test.
