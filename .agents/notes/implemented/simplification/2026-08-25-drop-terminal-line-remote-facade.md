# Agent Note: Drop the terminal line-oriented remote facade

Date: 2026-08-25
Lifecycle: implemented
Class: simplification
Status: implemented (proposal accepted and shipped the same day)

## Context

`@ryanyujazz/dsh-terminal-workbench` exposed ten browser-facing Typert Remotes, three of which were a line-oriented mirror of the official `ctx.terminals` API (`read`, `send`, `signal`) predating the raw-PTY `system` backend. The shipped Workbench client invoked only the other seven (`backends`/`list`/`spawn`/`kill` + `input`/`readRaw`/`resize`), so the three remotes and their nine wire types (`TerminalReadRequest`, `TerminalReadPage`, `TerminalSendView`, `TerminalSignalView`, `TerminalSignalName`, `TerminalWaitReason`, and the three `*RemoteResult` types) had zero callers.

## Decision

Deleted the three remote methods and the nine orphaned wire types; updated the remote-descriptor spec to the seven-method surface. The official line-oriented Bash Backend stays mounted inside the Host through the official `ctx.terminals` registry — only the unused browser-facing RPC mirror is gone. The regenerated `lib/typert.remote-client.js` after `pnpm run build` carries exactly the seven descriptors (the `signal` string remaining in the schema belongs to the `exited` status view's exit-signal field, not a method).

## Alternatives considered

Keeping the facade for a hypothetical line-mode client — rejected: DeepCreator ships host and client rows together in one bundle; no such client exists or is planned. Rewiring the browser terminal to the line API — rejected: raw ANSI over `input`/`readRaw` is the deliberate design.

## Verification

`rg "@Remote\('(read|send|signal)'\)|TerminalSendView|TerminalWaitReason|TerminalSignalName"` over the package returns no hits; package typecheck passes; the root runner executes `tests/remote.spec.ts` against the regenerated remote client and passes; consumer `ui-workbench-tools` typecheck and tests pass; full `pnpm run test` (231 files / 2487 tests) green. Owner: [terminal-workbench README](../../../packages/host/terminal-workbench/README.md).
