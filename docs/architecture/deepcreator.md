# DeepCreator architecture

DeepCreator is a presentation distribution over the official DeepSeek Harness runtime. The official process owns Agent execution, Session persistence, RPC, Settings, Workspace data, Client Runtime objects, and Slot rendering. DeepCreator owns Electron and the UI plugin rows listed by `@ryanyujazz/dsh-deepcreator-web`.

## Package boundaries

Each UI feature is one Cordis Client plugin. A feature may contain `contract`, `model-adapter`, `view-model`, and `view` directories when the code needs those distinctions; the directories do not create additional plugins. The model adapter reads official Runtime objects, the view model owns presentation-only stores and actions, and React views consume Slot-derived props. `apply.ts` is the only cross-domain assembly point.

`@ryanyujazz/dsh-client-compat` records the supported official package version and Git SHA and exports public types. Runtime object identity still comes directly from the official ModuleLoader table. `@ryanyujazz/dsh-client-ui-primitives` is an immediately available Client module whose Host apply is empty; it publishes shared React controls once and injects its global browser styles without owning business state.

## Composition

The `deepcreator` profile composes `dsh-base`, `dsh-web-app`, retained third-party bundles, and `dsh-deepcreator-web` in that order. The DeepCreator bundle disables replaced official UI rows and inserts custom rows under `deepcreator-*` ids. The development migrator links those bare plugin packages directly into the profile because a local `link:` bundle does not install its workspace dependencies. Shared extension points retain official Slot names. Product-only child slots use the `deepcreator.*` namespace. Official Client inject metadata remains descriptive; unchanged official plugins continue to register against the retained Slot services and were verified in the assembled browser.

The settings shell registers the Preferences block into `settings.general.item` and declares `deepcreator.settings.preferences.item`. Theme and conversation plugins register their durable preference rows into that child Slot. The settings namespace `ui-conversation`, fields `busyEnter` and `defaultRenderMode`, render ids `normal | classic | think`, and default `classic` remain stable.

## Desktop process boundary

Electron owns one sandboxed BrowserWindow and one system-Node `dsh --profile deepcreator --port 0` child. The renderer accepts only the exact loopback origin reported after Loader settlement. External HTTP(S) links open through the operating system. Shutdown sends SIGTERM, waits for process and stdio closure, then escalates to SIGKILL after the configured timeout. The private Electron data directory is distinct from earlier local applications that used the same visible DeepCreator name.

## Upstream updates

An official update changes the version and SHA in `packages/client/compat/compatibility.json`, updates package dependencies, and runs `pnpm run verify:harness`, typechecking, bundle builds, tests, a `dump-config` comparison, and visual regression. Compatibility failures are fixed in `compat` or the affected feature plugin. The official checkout is not patched and removed APIs do not receive silent fallbacks.
