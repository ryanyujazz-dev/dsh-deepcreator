# Profile migration instructions

This directory owns creation and refresh of the managed `deepcreator` profile.

- Back up both source and existing target profiles before mutation.
- Preserve source-profile third-party Bundles and user patch text except for explicitly retired DeepCreator rows.
- Remove obsolete ExecFlow rows and dependencies without modifying unrelated user configuration.
- Never migrate or copy global Sessions, Settings, Credentials, or Workspaces; DSH already shares them.
- Reject an existing target profile not marked as DeepCreator-managed. Do not silently take ownership.
- Link local packages only for development profiles. Published installation must use the Bundle dependency closure.
- Install dependencies, generate `dump-config`, verify required rows and absence of legacy rows, and keep repeated runs idempotent.
