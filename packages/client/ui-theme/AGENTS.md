# Theme plugin instructions

This package owns palette bootstrap, light/dark/system state, global design tokens, typography roles, font smoothing, and the Appearance settings row.

- Keep token names semantic and stable. Feature packages consume tokens rather than duplicating global colors or typography values.
- Apply font sizes and line heights directly; never scale text with transforms or browser zoom.
- Theme bootstrap must avoid a pre-activation flash and remain DOM-safe where Host code is evaluated.
- Appearance settings persist through the official settings service and register into the DeepCreator Preferences Slot.
- Every visual-token or typography change must update `UI_STYLE_GUIDE.md` and representative component tests or screenshots.
