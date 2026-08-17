# Workbench tool providers

Registers Artifact, Review, Terminal and user-facing Preview panel types; Preview retains the stable internal `browser` type id. Browser Web is usable for sandboxed loopback HTTP(S) previews. Artifact, Review and Terminal render explicit unavailable states until their Host Remote packages are composed; they never invent business data or imply unsupported diff mutations.

Provider views render Body content only. Refresh, Terminal control and create-tab actions are contributed to the public Workbench Panel Header; Artifact metadata, Review state and Preview URL entry are content, never a second subtitle toolbar.

Terminal Body uses an embedded xterm emulator connected to the Agent-fenced `system` PTY Remote. Keyboard data is delivered as ordered raw input, ANSI output is consumed incrementally with a monotonic cursor, and a `ResizeObserver` plus Fit addon keeps PTY rows/columns aligned with the Panel. Hiding a Group only removes visibility; it does not terminate the PTY. Legacy line-oriented sessions remain listable and closable but ask the user to create a new interactive terminal.

The first Terminal Group initialization opens a tab automatically: it restores a running terminal owned by the current Session when possible, otherwise it spawns one `system` PTY. This initialization is guarded per Session, so explicitly closing the final tab does not create a replacement; the Header plus creates additional terminals. Terminal has no management Home, back, SIGINT or separate kill button. Closing a Terminal tab immediately kills that PTY without confirmation; with no tabs, the Body shows only an empty state. Hiding the Terminal Group retains its tabs and processes.
