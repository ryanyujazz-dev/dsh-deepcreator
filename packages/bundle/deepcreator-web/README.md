# @ryanyujazz/dsh-deepcreator-web

The bundle now composes `ui-workbench` as the sole `details` occupant, followed by Activity and the Artifact/Review/Terminal/Browser providers. It disables the official `ui-jobs` row because Activity projects the same Runtime `jobsBySession` facts through the Workbench entry point.

DeepCreator's browser presentation bundle over the official `dsh-base` and `dsh-web-app` bundles. It replaces only DeepCreator-owned UI rows and preserves the official Host, RPC, Session, Runtime, Slot renderer, and unchanged feature plugins.

The bundle retains official slot names for shared extension points. DeepCreator-only nested surfaces use the `deepcreator.*` namespace, including `deepcreator.settings.preferences.item`.

The local development profile links the bundle and each bare Client plugin directly. Published installations use this manifest's dependency closure; the Cordis rows themselves never depend on a repository path or a central built-in plugin list.
