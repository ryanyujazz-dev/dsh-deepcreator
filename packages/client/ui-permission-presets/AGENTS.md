# Permission preset UI instructions

This package owns the default permission preference and the current Session permission selector.

- Treat the official permission projection and settings service as authoritative. UI choices do not weaken Host enforcement.
- Distinguish defaults for future sessions from changes applied to the current Session.
- Preserve confirmation, unavailable, remote-access, loading, and failure behavior; never imply a permission change before the Host commits it.
- Keep menus and setting rows aligned with shared primitives and `UI_STYLE_GUIDE.md`.
