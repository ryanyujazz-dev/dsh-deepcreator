# Locale plugin instructions

This package owns the zh/en preference, locale snapshots, typed namespace dictionaries, and the Slot locale face.

- Keep translation dictionaries with their feature owners; this package owns registry mechanics and common language behavior.
- Preserve the Host-backed preference and browser-language fallback semantics. Remote clients must not gain unauthorized Host settings writes.
- Locale changes must update mounted Slot-rendered copy without duplicating feature state.
- Do not put model-visible prompt text or tool schemas in this UI locale registry.
- Add dictionary typing, fallback, persistence, reconnect, and disposal tests for behavior changes.
