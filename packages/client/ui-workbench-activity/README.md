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
  rides `contributePanelInfo`). The body mounts an explicit non-navigating
  `SessionProvider` and invokes the main area's authorized
  `conversation.session` renderer in `transcriptOnly` form. It therefore uses
  the same official 50-message tail window, bounded on-demand row reveal followed by `hasMore/loadOlder` paging,
  assembler, live stream, Markdown, tool/file/detail actions, typography and
  render-mode preference as the main conversation, but mounts neither a
  composer nor a second render-mode picker.
  An instance-local body toolbar owns status and "Open in conversation";
  Workbench's shared header remains reserved for tabs and panel controls, and
  the body adds no duplicate child title. A child observation lease exists only while
  the tab, panel and document are visible. Hidden tabs mount no Session and do
  no transcript assembly or React commits. Closing a tab is view-only — the
  child keeps running.

The provider owns only disposable render state (tick clock, optimistic
stopping set and overview snapshot); Job and Session lifecycle stay with the
official Runtime stores.
