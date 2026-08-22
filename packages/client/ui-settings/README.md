# @ryanyujazz/dsh-client-ui-settings

English | [中文](README.zh.md)

DeepCreator's settings extension contract, layered over the retained official `@deepseek-ai/dsh-client-ui-settings` base. The official plugin remains the sole owner of `ctx.settingsScope`, `ctx.settingsSchema`, the shared describe mirror, and every official settings slot. This package declares only `deepcreator.settings.preferences.item`, the product-specific list seat inside DeepCreator's shared Preferences block, and re-exports official settings types for custom consumers.

Keeping the transport and schema services official is an update boundary: new official settings features can continue injecting the official module without depending on a DeepCreator reimplementation. This package has no runtime service implementation and must never disable or shadow the official `ui-settings` composition row.

## Model Experience

None. This package declares a browser UI extension seat and does not assemble model requests.

## Known Limitations and Deferred Work

- The custom Preferences seat exists only when the DeepCreator settings shell declares it.
- Durable settings behavior, including loopback restrictions and write semantics, follows the pinned official settings package.
