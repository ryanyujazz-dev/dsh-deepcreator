# @deepseek-ai/dsh-client-ui-subagent

English | [中文](README.zh.md)

Web subagent feature owner: reason-specific read-only replacements for the
conversation composer chain, plus the existing `@` reference source on
`ctx.inputTriggers`.

The session-header catalog tree this fork used to register on
`conversation.session.header.actions` is retired: subagent visibility now
lives in the Workbench's Activity panel (job rows, the subagent section, and
per-child tabs with the official conversation-area jump), keeping one home
per fact.

A one-shot child always elects a read-only composer that identifies the
transcript as a completed execution record. A continuable child does so only
when its exact parent is unavailable and the child is not running, with copy
explaining the recovery path; while such a child still runs, the selector
yields to the ordinary composer, whose input and Send action are disabled but
whose independent Stop stays usable, and the takeover returns once it stops.
A continuable child with a live parent keeps the ordinary input chrome, whose
Session routes prompts through `subagent.prompt`: typing and Send stay
available while the child runs because every follow-up joins the child's FIFO
inbox, while an independent Stop routes through `subagent.interrupt`. This
package never receives host context or calls a model-facing tool. The
composer behavior is specified by the [Web subagent conversations Agent
Note](../../../.agents/notes/implemented/feature/2026-07-27-web-subagent-conversations.md)
and the [current-turn interrupt Agent
Note](../../../.agents/notes/implemented/feature/2026-08-06-continuable-subagent-interrupt.md).

Subagent-origin Session rows are omitted from the ordinary sidebar; the
Activity panel is their navigation entry point. Ordinary forks remain in the
sidebar.

The `@` source remains deliberately separate and inert. Candidates are
zero-RPC running children from `ctx.sessions.list`; picking one inserts
literal `@label ` text, and the codec projects `@label`. It has no
command-adjudication hooks and does not resolve labels into continuation
addresses.

## Model Experience

### Subagent label text in the user prompt

#### What the model sees

Only the legacy `@` reference source affects model input: a picked candidate
reaches the ordinary user message as literal `@label`, without a dedicated
block or host-side resolution. Persisted transcript viewing adds no prompt
section; accepted continuation content becomes a normal FIFO user message
through the host subagent adapter.

#### Token effect

Conditional and append-only: the literal `@label` or a human follow-up adds
tokens only to its new user message. Transcript operations add zero model
tokens.

#### KV Cache effect

Append-only. This package never edits earlier request tokens.

## Known Limitations and Deferred Work

- **`@` references remain display-title text** — duplicate or renamed labels
  are ambiguous, so they intentionally do not acquire continuation semantics.
