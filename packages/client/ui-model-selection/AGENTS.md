# Model selection instructions

This package owns model-selection controls over the current Session's official model projection.

- Read available models from `session.models` and switch through the official Session API; do not create a parallel model registry.
- Keep new-session and active-session semantics explicit and preserve composer blocking when no valid route exists.
- Menus use shared primitives and typography tokens and must handle loading, unavailable, selected, and failure states.
- Model labels and capability metadata are presentation data, not a place to hardcode provider behavior.
