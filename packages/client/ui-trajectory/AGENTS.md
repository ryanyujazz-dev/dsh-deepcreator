# Trajectory plugin instructions

This package owns the trajectory ledger, timeline, virtual rows, selection, search, and its conversation view registration.

- Remain a pure consumer of the shared Session event window. Do not provide a duplicate Session service or read the Chat snapshot as business input.
- Build trajectory records deterministically from stable event ids and preserve row keys across streaming updates and older-page prepends.
- Register the trajectory target and view through conversation Slots; disposal removes both without changing the conversation shell.
- Keep virtual scrolling, timeline geometry, composer clearance, keyboard access, and shared execution typography consistent.
- Test record definitions, pagination, virtualization, selection, duration behavior, streaming, and Slot teardown.
