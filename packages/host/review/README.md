# DeepCreator Review Service

Scoped Git Review and per-turn change history for Workbench. The default `uncommitted` scope is `HEAD → worktree`; `unstaged` (`index → worktree`), `staged` (`HEAD → index`), and `{ turn }` (turn start → end) are also available. Per-file results carry unified patches and full source snapshots, including renames, deletes, untracked files, binaries, and symlinks.

Worktree snapshots are captured at official turn boundaries: start before the first `agent/pre-step`, end at awaited `agent/turn-stopping`, with `turn/end` as fallback. A temporary index writes Git trees without touching the real branch, index, or worktree. Synthetic commits under `refs/deepcreator/turns/{sessionId}/{turn}` retain active snapshots. Commit reconciliation is conservative and per file; completed turns become parentless lightweight tombstones, and session deletion removes the private refs.

`undoTurn` is the only mutation. It accepts only the newest unresolved turn, computes reverse three-way candidates for both index and worktree in temporary Git trees, rechecks HEAD/index/worktree for races, and only then applies the prepared result. Conflicts and stale state reject the whole operation, preserving later manual edits and preventing partial undo. No stage, unstage, or commit UI is provided.
