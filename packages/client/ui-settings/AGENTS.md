# Settings base instructions

This package owns the settings namespace scope and canonical settings Slot contracts.

- Keep this package small and presentation-neutral. Page chrome and Preferences content belong to `ui-settings-general` and feature plugins.
- Slot names and scope semantics are public extension points; change them only with all registrations, tests, Bundle rows, and documentation updated together.
- Do not copy settings documents into a second durable store. Official settings remain authoritative.
- Registrations must dispose cleanly so settings sections and rows can be independently removed.
