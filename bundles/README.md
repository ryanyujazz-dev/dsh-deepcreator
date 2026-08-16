# bundles/

Patch-layer bundles: the user-facing install unit of one plugin. A bundle is a tiny npm package whose
`cordis.patch.yml` disables the stock rows its fork packages replace and inserts the fork packages under
new ids. Slot keys stay official, so every other plugin keeps composing against the replaced seats.

Rules:

- Name: `@ryanyujazz/dsh-<plugin>`.
- `dependencies` pin the fork packages to the family version.
- The tested dsh range lives in the bundle README and in each fork package's `peerDependencies`.
