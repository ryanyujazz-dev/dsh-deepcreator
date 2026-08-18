# DeepCreator Session Admin

Host-owned session lifecycle administration the official harness does not
expose. One Typert Remote `delete` permanently destroys a persisted session:
it validates the session id (UUID), locates the session directory under the
shared sessions root (the official jsonl backend names each session directory
by the raw id), refuses ambiguous matches across workspaces, refuses live
sessions (`ctx.sessions` entry — the official write-behind would recreate the
log), and removes the directory. The caller closes the session and refreshes
the session list afterwards.
