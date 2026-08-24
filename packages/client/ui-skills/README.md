# @ryanyujazz/dsh-client-ui-skills

English | [中文](README.zh.md)

DeepCreator's Skills feature. It registers one `settings.section` (`skills`)
and one `sidebar.primary.action` shortcut that opens that same section through
the public Settings navigation service, and mounts its own generated Skill
Remote codec contribution instead of coupling it to Workbench Remotes. The React views receive only injected
callbacks and Remote projections; the official Host Skill registry remains the
catalog authority.

The section reuses ui-primitives' Button, Input, Menu, Modal,
RiskConfirmation, Tooltip, SidebarRow, and product Skill icon. Its only local
control is the domain-specific compact Skill switch.

Cards and details select `localizedDescriptions.zh` or `.en` from each Host
projection using the live application locale. A missing translation falls back
to the canonical Skill description; search covers both languages.
Details show the declared developer/content author separately from the source
bucket and technical provider, falling back to an explicit undeclared label.

## Model Experience

None. The package presents Host-projected Skill facts and actions in the
browser; model visibility is enforced by the Host registry policy.
