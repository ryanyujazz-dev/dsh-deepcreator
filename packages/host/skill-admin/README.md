# @ryanyujazz/dsh-skill-admin

English | [中文](README.zh.md)

DeepCreator's Host-side Skill management boundary. It reads the authoritative
`ctx.skills` registry, persists per-Skill disabled policy through the official
Settings service, and exposes guarded copy/link/Git install plus deletion for
direct children of the standard personal and current-project Skill roots.
When the Client supplies a live session id, catalog reads and lifecycle actions
resolve that official Agent and project the same global-plus-scoped Skill layers
used by its model-facing loader; agentless reads retain the global catalog.

Disabling one Skill registers a rank-zero policy candidate with both invocation
surfaces off. The original provider and file stay mounted and unchanged; enabling
removes that candidate. Immutable bundled/plugin sources may be disabled when
they expose a host-local definition, but only personal/project roots can be
removed.
The policy provider is registered both globally and in every live Agent scope,
so one persisted disabled choice cannot be shadowed by a preset-local provider.

Provider-owned `metadata.localizedDescriptions.{zh,en}` is projected to the
Client and preserved while a Skill is disabled. The canonical registry
description remains the fallback for providers that do not publish bilingual
presentation metadata.
Provider-owned `metadata.developer` is projected as content authorship and is
kept distinct from both installation source and runtime provider identity.

## Model Experience

Disabled Skills are projected through the official registry with both model
and user invocation turned off. No additional instructions enter model
requests.
