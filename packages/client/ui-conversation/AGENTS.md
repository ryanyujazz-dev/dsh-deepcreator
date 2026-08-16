# Conversation plugin instructions

This package owns the conversation shell, single header, view ring, ordered chat flow, composer, queue, details host, and conversation-scoped presentation stores.

- The official Session event window is the source of conversation data. Conversation projections must be deterministic and replayable from it.
- Tool-specific presentation belongs to `ui-tool`; trajectory projection belongs to `ui-trajectory`; external features enter through declared Slots.
- Keep `normal | classic | think`, the `ui-conversation` settings namespace, `busyEnter`, `defaultRenderMode`, and default `classic` stable unless a migration is deliberately implemented.
- Header and settings render-mode controls are two views of the same setting and current-session presentation state.
- Model output, tables, inline code, execution rows, composer input, placeholder, gradients, and scrolling behavior must follow `UI_STYLE_GUIDE.md`.
- Register conversation nodes and renderers rather than adding branches to a central event switch. Test streaming, replay, disposal, all render modes, and all typography sizes.
