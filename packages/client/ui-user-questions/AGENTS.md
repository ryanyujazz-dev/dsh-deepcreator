# User question UI instructions

This package owns browser presentation for pending `ask_user_question` interactions and composer takeover.

- Tool availability is an agent-preset concern; this Client plugin must not mount the model-visible tool globally.
- The Host owns pending and resolved state. Successful transport alone must not remove an interaction locally.
- Preserve structured single-select, multi-select, custom answer, skip, cancel, plan-review, IME, and accessibility behavior.
- Register question presentation through the conversation composer keyed Slot and dispose it with the declaration lifetime.
- Render model-provided text as untrusted content through shared markdown primitives.
