# @ryanyujazz/dsh-browser-iab

Concrete in-app Browser Provider. Electron Main owns the WebContentsView and automation session; this Host plugin connects only through the private authenticated Desktop RPC and registers the `iab` Provider with Browser Core.

An IAB tab uses `presentation.owner = "deepcreator"`, so Browser Core blocks control until `open_in_deepcreator` receives a presentation receipt for that exact logical tab.
