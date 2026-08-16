# packages

`client/` follows the official Harness feature-domain package model. Browser plugins keep a Node registration half and a bundled `lib/client.js`; pure libraries such as `compat` and `ui-primitives` have no Cordis row. `bundle/deepcreator-web` is the installable composition layer and declares every bare Client plugin package it inserts.

Official dependencies target the supported Harness version recorded in `client/compat/compatibility.json`. DeepCreator package dependencies use `workspace:^` and publish as one version family.

Import an updated feature implementation from a Harness checkout with:

```sh
node scripts/import-plugin.mjs <dsh-checkout> packages/client/<name> <name>
```

The import keeps package ownership under `@ryanyujazz`, rewrites dependencies on other DeepCreator-owned Client packages, and leaves official Runtime dependencies on the supported version.
