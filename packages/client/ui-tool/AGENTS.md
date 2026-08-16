# Tool UI instructions

This package owns the tool call tree, generic tool details, and the keyed per-tool presentation Slot.

- Tool names form an open runtime key space. Register keyed views and retain a generic fallback; never add a central built-in tool switch.
- Presentation is a pure projection of tool args, results, status, and declared UI intent. Do not execute tools or mutate Session events here.
- Collapsed tool rows follow the conversation body typography; expanded details may use the documented smaller detail role.
- Code, JSON, diffs, terminal output, errors, nested calls, and cancellation must remain readable and safe for untrusted content.
- Add model and renderer tests for each supported presentation intent and verify keyed registration disposal.
