---
name: dsh-web-gui-tester
description: "Test web frontends with DeepCreator Browser tools in a GUI-based, black-box manner: simulate user interactions, cross-validate structured snapshots with screenshots, and report results. Use when asked to test a webpage, verify UI behavior, reproduce a page bug, or test a provided URL."
---

# Web GUI testing with the built-in browser

This skill defines testing methodology on top of `dsh-browser-control` and its seven stable Browser tools. When its rules conflict with `dsh-browser-control`, the Browser control skill wins.

## Core principles

1. **Pure GUI black-box testing**: interact only with visible, operable elements, simulating real user behavior. Injecting JavaScript to modify state or bypass frontend logic is prohibited (the browser tools expose no injection surface by design).
2. **Faithful to the actual page**: conclusions come from the page's real behavior. If a normal GUI operation fails, record the issue and skip that path — do not force progress with unconventional methods.
3. **Separate testing from fixing**: never modify code under test during testing; fix only after testing is declared complete and the user asks for changes.
4. **Cross-validate structure and visuals**: every test point needs both a DOM observation (`browser_inspect {action:"snapshot"}`) and a visually inspected screenshot (`browser_inspect {action:"screenshot"}`) — one cannot replace the other.

## Plan

- Given explicit steps and expected results: skip planning.
- Given a feature/bug description: define the objective and acceptance criteria, then execute.
- Given only a URL or "test it": explore (open, snapshot, screenshot), identify core interactions, then organize test points by priority:
  - **P0 main flow** — the page's core path (form submit, search, tab switch).
  - **P1 interaction feedback** — loading, success/failure messages, disabled states, navigation.
  - **P2 input boundaries** — empty, over-long, special characters, duplicate submissions.
  - **P3 layout and styling** — overlap, overflow, alignment, visual quality.
  Stop and ask before testing that needs login credentials or writes real data (orders, payments, deletions).

## Execute: action → observe loop

- Open a fresh URL with `open_in_deepcreator {input:{kind:"url",url}}` for a visible test, or `browser_tabs {operation:"new",mode:"background",url}` for background testing. Continue only when the presentation result is `presented`; read the initial state with `browser_inspect {action:"snapshot"}`.
- Locate elements from snapshot facts only; confirm uniqueness before acting; one state-changing action per observation cycle.
- After every interaction and every page-state change, run **both** verifications:
  1. `browser_inspect {action:"snapshot"}` — element presence, content correctness, state changes.
  2. `browser_inspect {action:"screenshot"}` — layout, occlusion, rendering, visual quality. **View the returned artifact**; capturing without viewing is not observation. Keep routine checkpoints as session attachments. Give failed test evidence, important before/after states, and the final user-requested screenshot a descriptive `outputPath` under `output/browser/screenshots/`.
- Transient states (toasts, loading spinners): snapshot-then-act-then-snapshot quickly in succession so the state is captured before it disappears.
- When element location fails: re-observe (fresh snapshot + screenshot when needed) and decide whether it is a page bug (record + skip) or a locator issue (rebuild from new facts).
- When the page fails to load: screenshot the state, report it, skip dependent test points.
- When any presentation, wait, or action call fails: report the failure and re-observe only if the tool contract permits it. Never describe the requested state as reached merely because an earlier navigation started or a Provider still has a title/URL.
- Collect console errors when visible as page error manifestations (error text, blank regions, broken layout) and list them with the step at which they occurred.

## Report

Summarize per test point: passed / failed (with reproduction steps + screenshots) / blocked (why). Every test point references its viewed screenshot. Save screenshots only when the user requested them or when they are durable evidence worth keeping, then reference the returned workspace path; follow the user's requested report format when given.
