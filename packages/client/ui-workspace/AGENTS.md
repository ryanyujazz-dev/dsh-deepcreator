# Workspace plugin instructions

This package owns Workspace browser and picker presentation in the sidebar and empty conversation state.

- Official Workspace and Session Runtime objects remain authoritative for creation, selection, ordering, rename, archive, and deletion behavior.
- Register into sidebar and conversation Slots with `ctx.slots.inject()`; do not import their components.
- Keep native or remote directory picking behind the declared directory-flow child Slot.
- UI stores may retain expansion, display order, search query, and staged selection, but not duplicate durable Workspace data.
- Test grouped and flat views, empty states, selection, failure paths, external Slot lifetimes, and accessibility.
