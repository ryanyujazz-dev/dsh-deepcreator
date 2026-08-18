# Web input machine and the slash pipeline: the plain-text-reference decision

- Date: 2026-07-25
- Lifecycle: implemented
- Class: architecture
- Status: rebuilt 2026-08-18 — referenced by source comments and READMEs but never committed in the fork; decision restored from the referencing text.

## Context
The composer draft needs `/command` and `@reference` interactions without the draft itself becoming a structured document that every edit path must keep consistent.

## Decision
The draft carries plain text only. A `/name` or `@name` token whose name is on the trigger's lexicon derives a plain-text reference decoration (pure derivation — editing the text is always the source of truth, chip visuals are derived by scanning against the source lexicon, and pick inserts the literal `@label ` text). The input machine owns draft revisions and transactional events; the slash pipeline bridges external controllers onto it (begin-command / insert-reference / consume-token / insert-text), and the facade exposes a hot plain-text reference lexicon per shell — without a pipeline the snapshot is the empty Map.

## Alternatives considered
A structured chip model inside the draft (rejected: every mutation path re-derives structure; plain text plus a scan keeps undo, IME, and paste ordinary).

Full behavior text: [packages/client/ui-conversation/README.md](../../../packages/client/ui-conversation/README.md).
