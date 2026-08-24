# @deepseek-ai/dsh-client-ui-tool

English | [中文](README.zh.md)

Activity child transcripts invoke the same `conversation.session` renderer as the main area, so each toolview registers only once on `tool.call.toolview`; there is no mirror dispatch seat or adapter.


Client Tool presentation plugin. `ui-conversation` dispatches each ordered `tool-call` Conversation Node through the matching key of `conversation.chat.node`; this package renders its root and Code Dispatch children, then dispatches every atomic call through the keyed `tool.call.toolview` slot. Unregistered Tool names use the generic card.

Business UI packages register only their wire Tool names and atomic views. They do not pair Session events, rebuild the transcript, or own root/subcall topology. The Runtime remains authoritative for call/result pairing, lifecycle, and recursive `subCalls` projection; the conversation view remains authoritative for ChatFlow placement.

## Rendering contract

`ToolCallTree` receives one root `ToolCallBlock` that already contains recursive `subCalls`, selection state, the session `cwd`, and Host callbacks for opening files and inspecting calls. It recursively walks the standard call blocks and sends the root and children at every depth through the same atomic dispatch path, without subscribing to a separate parent-to-children map.

Each root and child wrapper preserves the `data-chat-anchor-key="call:<id>"` and `data-chat-call-id` DOM contract used for paging and selection.

The former `conversation.details.tool` registration and its `ToolDetails` renderer are removed together with `ui-conversation`'s retired DetailsPanel; the slot is gone from the contract. Tool inspection must be reintroduced later as a keyed Workbench Inspector Provider. Chat-row renderers continue to share pure card models for `terminal`, `read`, `diff`, `search`, and `web` render intents.

Generic rows classify known Tool names into search, read, shell, write, edit, code, or generic variants. Running, successful, failed, and interrupted lifecycle states come only from the frozen call/result slice. Write/Edit results preserve the optional official `oldStart`/`newStart` metadata, and their expanded cards use ui-primitives' shared line/word Diff model, real Shiki syntax tokens, single-number gutters, soft wrapping, and one composed card per file. Write and Edit omit DiffBlock's aggregate footer because their title row already carries the applied `+N -N` counts. Both keep their 42px file header above a code region capped at 420px, while Read uses the same 420px budget for its source body; longer content scrolls vertically inside the corresponding body. Historical results without start metadata remain renderable with blank line numbers. File paths resolve against the session `cwd` only when the user invokes the owner-supplied open-file callback; presentation code does not read Session or Workbench services.

In execution-flow render modes, expanded Tool bodies start at the 22px title column and share a 1px guide on the 16px leading glyph's x=8 centerline. A Code Dispatch branch keeps that guide on the parent Code row, while each child leading icon starts at the parent `Code` title's left edge. The Tool tree also adapts the pinned official `ui-skill` keyed row at this boundary because that renderer does not yet consume the owner's `execflow` flag.

The generic fallback also consumes durable image content blocks. It delegates loading, failure state, and click-to-zoom behavior to the conversation attachment owner instead of displaying attachment JSON as OUT text. Images are surface content, not disclosure content: the strip renders directly below the summary row and stays visible while the row is collapsed, so a browser screenshot reads without expanding the call. The strip takes 50% of the conversation flow width (the standalone-image rule), caps at 420px, and uses `contain`; execution-flow strips align to the 22px title column while the x=8 guide stays owned by the expanded `bodyWrap`, and normal mode keeps the native row inset. Media alone never makes a row expandable.

## Atomic Tool views

An owning business package registers its wire Tool name into `tool.call.toolview`:

```ts ignore-check
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({
    name: 'tool.call.toolview',
    key: '<wire tool name>',
  }, BusinessToolRow))
```

The owner payload is `ToolCallOwnerProps`: `callId`, `toolName`, the frozen `block`, optional `cwd`, and plain `openFile`/`revealChange`/`inspect` callbacks. The registration receives the normal session slot runtime share. It does not receive React nodes, Runtime services, or root/subcall knowledge. Mutation rows (write/edit, plus any generic call whose render intent is a diff card) prefer the optional `revealChange` for their path link — it focuses the file's change in the review surface — and fall back to `openFile` when the owner supplies none; Read and other ordinary file rows keep the owner-defined `openFile` behavior (DeepCreator conversation routes it Artifact-first).

This package currently owns the generic fallback and the built-in shell/pwsh, read, write/edit, grep/glob, web, todo, question, and Code Dispatch presentations. `ui-skill` demonstrates a business-owned registration for `skill`.

Card-specific limits and fallback rules remain in the owning [terminal](../../../.agents/notes/implemented/feature/2026-07-28-web-terminal-card.md), [diff](../../../.agents/notes/implemented/feature/2026-07-30-web-diff-card.md), [read](../../../.agents/notes/implemented/feature/2026-07-30-web-read-card-frontend.md), [search](../../../.agents/notes/implemented/feature/2026-07-30-web-search-card.md), and [web](../../../.agents/notes/implemented/feature/2026-07-30-web-result-card-frontend.md) notes.

## Model Experience

None, as this package renders already logged Tool calls and results without altering model requests, Tool execution, or session events.

#### KV Cache effect

None. The package is client-only presentation.

## Known Limitations and Deferred Work

- The Host excludes `run_code` from Code Mode program bindings, so production events produce one dispatch level; the recursive Runtime/UI contract supports nesting.
- First-party Tool views are colocated here and can move to their owning business packages independently through the keyed slot.
- Tool copy reuses the `ui-conversation` locale namespace.
