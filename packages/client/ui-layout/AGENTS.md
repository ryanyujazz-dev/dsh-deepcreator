# Layout plugin instructions

This package owns the three-column application frame, panel resizing, navigation state, and layout presentation service.

- Own page geometry and presentation state only; do not absorb sidebar, workspace, conversation, or settings business logic.
- Render only declared child Slots and pass ordinary props or callbacks into their occupants.
- Panel sizes and active navigation may live in layout stores; Session and Workspace data may not.
- Preserve single-owner rendering of the root application frame and reversible Slot/service registration.
- Test column visibility, resizing bounds, navigation transitions, and teardown after layout changes.
