# Slot type chain across layout and the sidebar

- Date: 2026-07-22
- Lifecycle: implemented
- Class: architecture
- Status: rebuilt 2026-08-18 — referenced by package READMEs but never committed in the fork; decision restored from the referencing README text

## Context
The shell frame (ui-layout) owns persistent chrome while feature packages contribute surfaces through typed Slots; the sidebar needed a close/reopen story that never duplicates controls.

## Decision
Closing removes the sidebar surface completely; ui-sidebar contributes the sole reopen control into layout's `deepcreator.shell.sidebar-toggle` frame seat instead of mounting its own floating button. ui-workspace owns the `sidebar.workspaces` rows and their view preferences; ui-sidebar derives none of those rows. The slot type chain (declare → register → owner props) keeps each side compiling against the other's contract without sharing state.

## Alternatives considered
A persistent mini-rail (rejected: two surfaces to keep in sync) and a sidebar-owned overlay button (rejected: duplicates the frame's chrome responsibility).

Full behavior text: [packages/client/ui-sidebar/README.md](../../../packages/client/ui-sidebar/README.md).
