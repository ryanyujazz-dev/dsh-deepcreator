# General settings instructions

This package owns settings-page chrome, the General section, the Preferences block, onboarding, and `deepcreator.settings.preferences.item`.

- The Preferences block is an owner that renders contributions; theme, conversation, and future feature settings register their own rows through its child Slot.
- Preserve official settings sections and unchanged third-party contributions. Do not hardcode a closed list of settings plugins.
- Keep block spacing, separators, typography, controls, menus, and empty/loading states aligned with `UI_STYLE_GUIDE.md`.
- Settings writes go through official services and surface failures; do not optimistically create a second durable truth.
- Test shell triggers, section registration, child Slot lifetime, document state, and appearance consistency.
