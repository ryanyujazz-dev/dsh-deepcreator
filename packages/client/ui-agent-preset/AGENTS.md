# Agent preset UI instructions

This package owns preset selection for future sessions, current-session preset labeling, and preset roster management surfaces.

- A running Session's preset is immutable. Default or staged selections apply only before the Session begins.
- Use official preset roster and management RPCs; do not parse or edit composition YAML in the browser.
- Shipped presets are read-only. User preset creation is a validated Host-side copy and never silently overwrites an id.
- Preset UI changes must preserve broken/unavailable states, loopback-only management restrictions, reconnect behavior, and Slot disposal.
- Agent composition mechanics belong to the official Harness; this package only presents their public APIs.
