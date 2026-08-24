# @ryanyujazz/dsh-browser-iab

Concrete in-app Browser Provider. Electron Main owns the WebContentsView and automation session; this Host plugin connects only through the private authenticated Desktop RPC and registers the `iab` Provider with Browser Core.

An IAB tab uses `presentation.owner = "deepcreator"`, so Browser Core blocks control until `open_in_deepcreator` receives a presentation receipt for that exact logical tab.

Electron Main executes multi-step semantic transactions under one control-interruption serial. It normalizes implicit ARIA roles and stable locator candidates, listens to both `did-navigate` and `did-navigate-in-page`, and settles `expected:"navigation"` plus the shared URL postcondition before returning. Waiting is reserved for independent asynchronous state and never refreshes a stale snapshot.

Navigation transactions adopt `_blank` anchors and synchronous `window.open` destinations into the same logical tab by default. `popupPolicy:"deny"` fails immediately with `POPUP_BLOCKED`. Ambiguous semantic locators fail before mutation, while a postcondition timeout reports that the action was applied together with the final tab state rather than mislabeling the whole action as failed.
