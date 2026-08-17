# DeepCreator Review Service

Read-only Git repository facts for Workbench: status, `git diff --check`, and one-file patch layers. `staged` is `HEAD → index`; `working-tree` is `index → worktree`. Each layer includes its patch and source snapshots so the client can preserve multiline syntax state while mapping unified hunk starts to absolute line numbers. Rename/copy paths and binary changes remain explicit. Every call re-resolves the canonical workspace/repository root and fences worktree reads to that repository. No stage, discard, commit, or mutation API exists.
