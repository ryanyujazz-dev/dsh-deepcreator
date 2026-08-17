# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel-geometry service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, `deepcreator.shell.sidebar-toggle`, and `shell.overlay`. The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar contributes zero width and no residual rail. AppFrame instead seats its independent reopen control at the left of the conversation header, so its position is identical in the New Session hero and an active conversation. On macOS the red light begins at x=20, aligned with the New Session icon below; the wordmark begins at x=89, preserving the same 9px visible gap used between native buttons. The reopen button box begins at x=82 so its centered glyph shares that x=89 visible edge. The conversation header itself keeps 12px horizontal padding whether the sidebar is open or closed; only its title cluster receives the platform-safe reservation (98px on macOS, 32px elsewhere), leaving centered tabs unchanged. All controls share the 48px header's y=24 centerline. The frame marks only a macOS Electron renderer and keeps a narrow top-edge drag fallback; the sidebar, conversation, and details owners use that same marker to make their full visible header whitespace draggable while excluding real controls. Windows and Linux retain only their system title bar. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`. The transient layout store starts the sidebar at its default width and details closed, and it never reads or writes `localStorage`. Hero and other unselected states also derive a zero rendered details width without changing that stored preference. AppFrame retains the last non-blank Session id across those states: the first Session remains closed, an explicit details action opens the contract default width, returning to the same Session restores its unchanged width, and selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Panel geometry is transient** — reload restores the sidebar default and details closed; switching between distinct Session ids also closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
