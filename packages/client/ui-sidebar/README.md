# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

Independently installed features contribute optional primary rows through `deepcreator.sidebar.primary.action`; when unoccupied, that Slot adds no DOM or spacing.

Sidebar shell plugin: the wordmark, marginless primary-action list, collapse/reopen controls, scroll-aware region seat, and bottom-pinned Settings seat. The primary list uses the same `SidebarRow` geometry as Workspace/project and Session titles: New Session is followed by disabled Skills and Scheduled Tasks placeholders, with list-owned 2px row rhythm and no vertical outer margin. [ui-workspace](../ui-workspace/README.md) owns the Workspace and Session browser rendered into `sidebar.workspaces`; this package neither derives its rows nor owns its view preferences. Closing removes the sidebar surface completely; this package contributes the sole reopen control into layout's `deepcreator.shell.sidebar-toggle` frame seat. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The shell renders the DeepCreator wordmark in its marginless 48px brand row and publishes `--dsh-sidebar-section-margin-top: 10px` for independently owned content regions below the primary list. Regions use that token only as a top margin, leaving their bottom margin empty; WorkspaceBrowser consumes it today and a future pinned region will share the same rhythm. Standard sidebar action glyphs use ui-primitives' shared 14px metric; the 16px whale remains an optical brand exception in the expanded wordmark. Under the macOS Electron marker, that wordmark begins after the native traffic lights; its hit target hugs the visible mark so all remaining blank row space drags the window, while the wordmark and panel control are explicitly non-drag interactive surfaces. When closed, the panel icon appears in layout's stable 28px frame seat instead of retaining sidebar brand chrome.

New Session starts the runtime's page-local frontend Session Intent. The runtime targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page. Skills and Scheduled Tasks are deliberately presentation-only and disabled until feature plugins supply real behavior. Workspace-specific controls and the shared picker belong to ui-workspace.

`SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared `sidebar.workspaces` and `sidebar.settings` child slots, and injected `startSession` plus sidebar-toggle callbacks. There is no plugin store.

During a live close, the shell holds the expanded content at its current width while it fades out for 150ms inside the shrinking column. It is inert throughout that exit and contributes no DOM after settlement. The independent reopen control is visible immediately in the frame seat and never moves with the grid transition. A page that starts closed renders no sidebar DOM; reduced-motion mode disables the fade.

Scrollbars in the column are a pointer affordance: the shell rebinds ui-theme's [scrollbar indirection](../ui-theme/README.md) to `transparent` whenever the pointer is outside it, and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region ([ui-workspace](../ui-workspace/README.md)), so revealing a thumb never reflows.

The foot is the `sidebar.settings` seat: the sidebar renders only the bottom-pinned layout slot and shares its column state (`wide`); ui-settings registers the trigger row and settings panel there.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

## Model Experience

None, as the sidebar renders the browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Session state-dot rendering is owned by [ui-workspace](../ui-workspace/README.md)** — no done/error notification sources are available.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to [ui-workspace](../ui-workspace/README.md), not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
