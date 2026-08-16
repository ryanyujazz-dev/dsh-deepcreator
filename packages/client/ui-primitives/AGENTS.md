# UI primitives instructions

This package owns reusable React atoms, icons, markdown, inspectors, menus, tooltips, and shared control behavior.

- Primitives are business-state-free and receive all data and callbacks through props.
- Do not access Cordis context, Runtime services, settings, or feature stores from a primitive.
- Add a primitive only when multiple feature packages need the same semantic control; feature-specific components remain with their feature.
- Preserve accessibility, keyboard behavior, focus visibility, and menu/tooltip sizing across all consumers.
- Shared visual changes must follow and update `UI_STYLE_GUIDE.md`; avoid per-consumer scaling overrides.
