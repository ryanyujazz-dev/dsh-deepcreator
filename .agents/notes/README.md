# DeepCreator Agent Notes

Decision records for DeepCreator. One file per durable decision, filed under `.agents/notes/<lifecycle>/<class>/yyyy-mm-dd-topic.md`:

- **Lifecycle**: `implemented` (the decision ships) · `archived` (frozen historical snapshot).
- **Class**: `architecture` · `bug-fix` · `feature` · `simplification`.

Notes use a minimal header block (title plus Date / Lifecycle / Class / Status lines), `## Context`, `## Decision`, `## Alternatives considered`, and a link to the owning package README that carries the full behavior text. Keep each paragraph on one physical line and use relative Markdown links. In `implemented/` notes, keep the verification contract (which behaviors and test tiers pin the decision); drop migration plans and future-tense spec language.

`archived/` is frozen: never edit, re-record, or modernize its contents; active prose may repair or redirect an inbound link but must not follow cleanups into the frozen target.

The tree was rebuilt on 2026-08-18: the original notes from the fork's upstream history were referenced by package READMEs and the bundled official skills but were never committed to this repository. Each rebuilt record restores its decision from the referencing README text; the Status line marks it as such.
