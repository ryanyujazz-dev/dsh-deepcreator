# @ryanyujazz/dsh-browser-chrome

System Chrome Provider. A Manifest V3 extension shares only tabs explicitly approved from the extension action, while an authenticated Native Messaging bridge connects Chrome to Browser Runtime without a remote-debugging port.

The provider owns Chrome visibility. DeepCreator presentation is optional and snapshot-only. Installation is explicit through `installChromeIntegration`; it is never performed during normal runtime startup.

The extension normalizes implicit ARIA roles, returns stable role locators beside versioned snapshot refs, executes multi-step action transactions without invalidating the ref map between steps, and uses the shared exact/contains/glob URL contract. Navigation postconditions observe Chrome tab revision plus the final load state before returning.

Stable locators are emitted only for unique exact role/name pairs, and semantic ambiguity fails before action. The injected transaction captures synchronous `window.open`, adopts new-tab destinations into the shared current tab by default, and supports immediate `POPUP_BLOCKED` failure under `popupPolicy:"deny"`. Applied actions that miss their postcondition return structured final-tab details rather than a generic timeout.
