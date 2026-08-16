# Documentation instructions

Documentation describes the current DeepCreator implementation and its supported workflows.

- Keep one authoritative home per fact: package behavior in its README, repository boundaries in `docs/architecture`, and visual rules in `UI_STYLE_GUIDE.md`.
- Update docs in the same change as public Slots, settings, commands, ownership, lifecycle, or official-version support.
- Describe current behavior directly. Separate deferred work from implemented behavior and remove obsolete migration-era claims.
- Code examples must use current package names, paths, profile names, and commands and must not contain local credentials or user data.
- Architecture diagrams must preserve the official-runtime/DeepCreator-plugin ownership boundary.
- UI style reports and decisions must agree with the semantic tokens and actual component implementation.
