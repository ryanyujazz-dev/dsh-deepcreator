# Host-backed web preferences through the official settings service

- Date: 2026-08-06
- Lifecycle: implemented
- Class: bug-fix
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
Browser-selected preferences (theme, language) used to live only in localStorage, so relaunches and remote browsers diverged from the desktop's stored state.

## Decision
The preference persists through the official settings service into `$DSH_HOME/settings.yaml`. Pushed settings changes and reconnects both re-pull the value; rapid selections serialize writes in operation order carrying a namespace revision, and a rejected latest write reloads the persisted value. Remote browsers cannot reach the loopback-only settings API, so their selection stays process-local. Registered third-party theme ids remain an in-process extension that never crosses the built-in settings schema; removing one never overwrites the last durable built-in preference.

## Alternatives considered
localStorage-only persistence (the prior behavior) and mirroring the file directly from the browser (rejected: bypasses the official service and its revision fencing).

Full behavior text: [packages/client/ui-theme/README.md](../../../packages/client/ui-theme/README.md).
