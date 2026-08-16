# Script instructions

Scripts automate import, testing, profile migration, compatibility verification, and release operations.

- Resolve paths from the script location or explicit environment variables, never from an assumed caller directory.
- Validate exact targets before writes. Back up user-controlled configuration before replacement and fail on ambiguous ownership.
- Keep scripts non-interactive unless the command is explicitly an interactive workflow. Errors must identify the failed path or package.
- Avoid shell interpolation for package names, versions, or paths; prefer argument arrays and structured file parsing.
- Make safe migration and verification commands repeatable. A second run must not duplicate rows, dependencies, or backups inside the target profile.
- Never print credentials or copy settings, sessions, workspaces, or credential stores into the repository.
- Update README usage and tests whenever command behavior or supported layout changes.
