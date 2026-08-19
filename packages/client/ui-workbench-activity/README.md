# Workbench Activity provider

Registers the `activity` Workbench type and owns two routes:

- **Home** — one vertical page anchored to the conversation's home session
  (`currentAddress.parentSessionId` while a subagent is opened in the
  conversation area, so the panel keeps showing the PARENT's activity instead
  of re-scoping to the child). Sections: the subagent catalog first, then
  running/finished background jobs (`jobsBySession`, live-ticking durations in
  the official two-unit format, stoppable through the `jobs-admin` Host
  remote). Subagents group by participation: **This turn** (children whose
  latest activity postdates the parent's latest user-authored message,
  running first, most recently active first — a re-invoked continuable child
  bumps back to the top) and **Earlier**, from the `jobs-admin`
  `subagentOverview` recency projection; without it the list degrades to one
  flat running-first list. Subagent cards are borderless content cards
  (background fills distinguish resting/hover/open); a running child's label
  breathes. The child currently opened in the conversation area renders
  dimmed with a "Close from conversation" control in place of the mode·state
  meta (the official breadcrumb path, `sessions.open(parent)`); clicking the
  card still opens its tab.
- **Instance** — one subagent child per tab (the Workbench's own
  `WorkbenchPanelTabs`; the instance id is the child session id, the label
  rides `contributePanelInfo`). The body is the conversation area's
  **classic-mode execution flow** rendered through the
  `deepcreator.conversation.embed` slot: raw child events
  (`jobs-admin` → `subagentEvents`, full window then `afterSeq` deltas on an
  adaptive 120–400ms chase cadence while the child runs and the group is
  visible) are folded by the OFFICIAL `ConversationNodeAssembler` and
  rendered read-only with the shipped node/tool renderers (fixed classic form
  — no mode ring, no composer, no Think switch). The drafting indicators
  ("Deep diving…" status row, per-tool "Creating" rows) show on the union of
  the catalog activity bit, the session summary's running flag, and live
  event flow (deltas only — the initial history window never lights it). The
  tab's content persists for the child's whole lifecycle: the embed engine
  deduplicates by seq, so a remount's full window degrades to its own delta.
  Pending parent-appended inbox work renders as one floating read-only queue
  card at the flow tail — a detached rounded card (all four corners, full
  border, soft shadow) whose live height reserves a safe area under the flow
  (the scroll floor clears the card); intervention goes through the official
  `sessions.openSubagent` jump, after which the panel routes back to Home.
  Closing a tab is view-only — the child keeps running.

The provider owns only disposable render state (tick clock, optimistic
stopping set, poll results, overview snapshot); Job and Session lifecycle
stay with the official Runtime stores.
