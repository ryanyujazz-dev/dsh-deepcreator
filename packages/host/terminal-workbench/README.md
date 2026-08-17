# DeepCreator Terminal Workbench Remote

Agent-scoped facade and interactive system-shell backend for the official `ctx.terminals` service. The backend receives the registry-minted terminal id and exact live Agent, so the official service remains authoritative for ownership, listing, close and Agent/Host teardown. DeepCreator adds only the user-facing terminal mechanics that the line-oriented official backend does not expose: raw ANSI reads, ordered raw input and PTY resize.

The terminal always runs on the local Desktop Host. Windows uses `node-pty` ConPTY and resolves `pwsh.exe`, Windows PowerShell, then `cmd.exe`; macOS and Linux prefer the Host user's login shell and use zsh/bash/sh fallbacks. New Workbench terminals start at the ordinary Session's workspace root. Child environments retain normal user PATH/HOME/locale values while the official subprocess scrub removes Harness and credential-shaped environment variables.

The `system` backend is additive. The official Bash backend remains composed for existing model/tool consumers, while Workbench places `system` first for newly created user terminals. Sessions remain process-local and disappear with their exact Agent or Host process; a Host restart never recreates them.
