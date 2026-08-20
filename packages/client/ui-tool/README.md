# @deepseek-ai/dsh-client-ui-tool

English | [中文](README.zh.md)

Every toolview registrant now registers on BOTH dispatch seats — `tool.call.toolview` (the conversation flow) and `deepcreator.conversation.embed.toolview` (the Activity panel's embedded child flow) — and the Tool tree renders on the mirror node seat through the `EmbedToolCallTree` adapter, so the embedded classic-mode flow shows the same tool rows as the conversation area.


Client Tool presentation plugin. `ui-conversation` dispatches each ordered `tool-call` Conversation Node through the matching key of `conversation.chat.node`; this package renders its root and Code Dispatch children, then dispatches every atomic call through the keyed `tool.call.toolview` slot. Unregistered Tool names use the generic card.

Business UI packages register only their wire Tool names and atomic views. They do not pair Session events, rebuild the transcript, or own root/subcall topology. The Runtime remains authoritative for call/result pairing, lifecycle, and recursive `subCalls` projection; the conversation view remains authoritative for ChatFlow placement.

## Rendering contract

`ToolCallTree` receives one root `ToolCallBlock` that already contains recursive `subCalls`, selection state, the session `cwd`, and Host callbacks for opening files and inspecting calls. It recursively walks the standard call blocks and sends the root and children at every depth through the same atomic dispatch path, without subscribing to a separate parent-to-children map.

Each root and child wrapper preserves the `data-chat-anchor-key="call:<id>"` and `data-chat-call-id` DOM contract used for paging and selection.

The former `conversation.details.tool` registration and its `ToolDetails` renderer are removed together with `ui-conversation`'s retired DetailsPanel; the slot is gone from the contract. Tool inspection must be reintroduced later as a keyed Workbench Inspector Provider. Chat-row renderers continue to share pure card models for `terminal`, `read`, `diff`, `search`, and `web` render intents.

Generic rows classify known Tool names into search, read, shell, write, edit, code, or generic variants. Running, successful, failed, and interrupted lifecycle states come only from the frozen call/result slice. Write/Edit results preserve the optional official `oldStart`/`newStart` metadata, and their expanded cards use ui-primitives' shared line/word Diff model, real Shiki syntax tokens, single-number gutters, soft wrapping, and one composed card per file. An Edit card omits DiffBlock's aggregate footer and keeps its 42px file header above a code region capped at 216px; longer content scrolls inside that region. Historical results without start metadata remain renderable with blank line numbers. File paths resolve against the session `cwd` only when the user invokes the owner-supplied open-file callback; presentation code does not read Session or Workbench services.

In execution-flow render modes, expanded Tool bodies start at the 22px title column and share a 1px guide on the 16px leading glyph's x=8 centerline. A Code Dispatch branch keeps that guide on the parent Code row, while each child leading icon starts at the parent `Code` title's left edge. The Tool tree also adapts the pinned official `ui-skill` keyed row at this boundary because that renderer does not yet consume the owner's `execflow` flag.

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
