---
name: dsh-browser-control
description: Select and control DeepCreator Browser Providers through the semantic Browser tools. Required reading before browser_list, browser_tabs, browser_navigate, browser_inspect, browser_act, browser_wait, or open_in_deepcreator.
---

# DeepCreator Browser control

Browser automation and Browser placement are independent dimensions. Playwright is an automation capability; Managed Chromium/Firefox/WebKit, the built-in Browser (IAB), and system Chrome are Providers. Always express requirements and let `browser_list` resolve them.

## Selection tree

- Ordinary browsing, testing, or batch work: request `automation:"semantic", visibility:"background"`. The default is Managed Playwright Chromium.
- Full Playwright Library behavior: use the separate `dsh-playwright-control` skill and request `automation:"playwright"` or call `playwright_run`.
- “Let me watch”: request `visibility:"live"`. Runtime follows the configured visible Provider order; do not hard-code IAB.
- Login, CAPTCHA, secret input, or user takeover: request `visibility:"live", interaction:"manual-handoff"` plus capability `interaction.secret-input-shielded`. IAB or Chrome may satisfy it.
- Existing Chrome state or an existing tab: request `profile:"user"` and `profile.user-tabs`; only the Chrome extension Provider may satisfy it. Only tabs explicitly shared from the extension are visible to the Agent.
- Explicit `browserId`, family, or engine is strict. Never retry by silently changing Provider. A created tab remains attached to its original Provider.
- If no Provider satisfies the combination, report `CAPABILITY_UNSUPPORTED` and its per-candidate missing capabilities.

Legacy `mode:"visible"|"background"` and `browserId:"headless"` exist for one compatibility release. Prefer requirement fields; `headless` deterministically aliases `playwright-chromium` and is not failure fallback.

## Presentation is a separate capability

- `open_in_deepcreator({input:{kind:"url",url}})` means “present inside DeepCreator.” It never opens system Chrome under that name.
- `browser_tabs new` returns a runtime-factual `nextAction`. If it is `open-in-deepcreator`, call that tool once with the exact returned `tabId` before control. This is how IAB proves the displayed Surface and automated tab are identical.
- If `nextAction.kind` is `ready`, do not infer a DeepCreator panel is needed. Chrome owns and focuses its own live window; headed Playwright owns its managed window. Either can still be shown in DeepCreator explicitly as a read-only snapshot.
- Reuse the logical `tabId`; never reopen a panel for each click. A dismissed DeepCreator resource remains dismissed for the turn, while its tab can continue running.
- Treat `presented`, `suppressed`, and `unavailable` literally. A loaded page is not proof of presentation. Do not retry a non-retryable receipt.

## Observe, act, and hand off

1. For research and reading, call `browser_inspect document` first. Continue long pages with the returned `documentId` and `nextOffset`; restart without `documentId` after `STALE_DOCUMENT`.
2. For interaction, take a fresh `browser_inspect snapshot`. A node locator is the versioned pair `snapshotId + nodeRef`.
3. Perform one `browser_act` using the node, role/name, text, or label locator.
4. Use `browser_wait` for actual state, not fixed sleeps, then inspect again.
5. Use `browser_inspect screenshot` when visual rendering matters. Its result already contains a durable model-visible image; do not search the shell or workspace for screenshot files.
6. For manual input call `browser_tabs handoffToUser`; wait until the user explicitly confirms they finished, then call `resumeControl` and approve the one-time control-return prompt before re-inspecting. User input during Agent control produces `CONTROL_INTERRUPTED`; `reacquire` has the same approval boundary, so never continue blindly.

Side-effecting actions require one-time approval before mutation. Passwords, OTP, payment data, cookies, and tokens must never enter Browser tool arguments or results. They are entered by the user during shielded handoff.

## Lifetime

- Background tabs are temporary and close at turn end unless marked `deliverable` or `handoff`.
- Provider-owned visible tabs and successfully presented URL resources (live IAB or managed snapshot) automatically become deliverables and remain open.
- Claimed user Chrome tabs are released, never closed, at turn end.
- `markHandoff` preserves a tab for exactly the next turn; mark it again if another continuation is required.
- Do not replay non-idempotent actions after failures.

Stable errors include `ACCESS_DENIED`, `HEADLESS_BLOCKED`, and `STALE_DOCUMENT` in addition to the existing Browser vocabulary. Do not reinterpret every 403 as login: use a live IAB for an explicit authentication/challenge surface, otherwise report access denial and the returned diagnostic details.
