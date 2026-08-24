# DeepCreator Platform Context

Win32 host facts as one dynamic runtime-context snapshot on the official
`ctx.systemPrompt` registry. The plugin detects once at start whether
`pwsh.exe` (PowerShell 7) is reachable — the pwsh tool silently falls back to
Windows PowerShell 5.1 when it is not, and nothing else in the harness
discloses that to the model.

With only PowerShell 5.1 present, the snapshot states the facts that decide
how Windows scripts must be written:

- a `.ps1` saved as UTF-8 without BOM is parsed with the legacy ANSI codepage
  (GBK on zh-CN hosts), so non-ASCII literals become mojibake that can swallow
  adjacent ASCII syntax — generated scripts stay ASCII-only;
- PowerShell 7-only syntax (`` `u{XXXX} `` escapes, `??`/`?:` operators,
  `ConvertFrom-Json -AsHashtable`) does not exist — `[char]N` instead;
- file reads and writes need an explicit encoding (`-Encoding UTF8` or
  `[IO.File]` methods);
- paths with spaces or non-ASCII characters stay quoted;
- GUI subprocesses (Edge, Chrome, Electron) dying on mojo/platform-channel
  access-denied inside the sandbox is named-pipe IPC being blocked, not a
  browser problem — escalate once or use the managed Browser Providers.

With PowerShell 7 installed the snapshot shrinks to that fact plus the last
two bullets. Non-Windows hosts produce empty text and register nothing: empty
context contributions are dropped by the official registry, so macOS/Linux
assemblies stay byte-identical to an uncomposed tree. The contribution is
ordered at 120, after the official sandbox (110) and approval (115) policies.

The DeepCreator bundle composes the plugin as `deepcreator-platform-context`;
disabling that row is the opt-out. Package tests pin detection, the 5.1/7
text split, empty-text gating off Windows, and the single ordered
registration.
