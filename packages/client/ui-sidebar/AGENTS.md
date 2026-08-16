# Sidebar plugin instructions

This package owns sidebar chrome, the Session tree, search presentation, collapsed and expanded states, and sidebar Slot declarations.

- Read Session projections from the official Runtime; do not create a parallel Session registry.
- Workspace adoption and mutation belong to `ui-workspace`; expose or render its contribution through Slots.
- Keep expanded and rail controls aligned to the shared size and typography tokens in `UI_STYLE_GUIDE.md`.
- Menus, search, hover cards, status indicators, and keyboard navigation must remain accessible and consistent.
- Test both sidebar states, Slot occupancy, scrolling, search, and disposal when changing the shell.
