# @ryanyujazz/dsh-client-ui-browser

React-free Browser state store, native Surface host, and default Workbench Browser Presenter. The generic capability/claim loop and Presenter registry live in `@ryanyujazz/dsh-client-presentation`; this package contributes only `browser-tab`. The Host is authoritative and Browser state is refetched atomically after revisions. `getSnapshot()` is referentially stable between real publications, as required by React external stores.

Live presentation uses a staged handshake: panel render starts the mount, native bridge rejection is reported immediately, and only a completed mount plus visibility update acknowledges `presented`. Failures distinguish `PANEL_RENDER_TIMEOUT`, `SURFACE_MOUNT_REJECTED`, `SURFACE_MOUNT_TIMEOUT`, and `SURFACE_DESTROYED`. Replacing the panel means registering another Browser `PresentationProvider` and, for live pages, another Surface host.

The live Surface is mounted with the current panel-body rectangle, then measured again after the asynchronous native mount completes; later ResizeObserver updates keep the WebContents viewport equal to the panel width and height. This prevents the initial Workbench layout transition from leaving the page at a stale width.
