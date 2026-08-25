# Workbench Activity provider

Registers the `activity` Workbench type and owns two routes:

- **Home** — one vertical page anchored to the conversation's home session
  (`currentAddress.parentSessionId` while a subagent is opened in the
  conversation area, so the panel keeps showing the PARENT's activity instead
  of re-scoping to the child). Sections: the subagent catalog first, then
  running/finished background jobs (`jobsBySession`, live-ticking durations in
  the official two-unit format, stoppable through the `jobs-admin` Host
  remote). Every job row is pointer- and keyboard-openable as a Workbench tab;
  its instance shows the complete untruncated command, id, kind, live status,
  duration and Stop action from the official `JobView`. It deliberately does
  not call the consuming `ctx.jobs.read()` cursor: output appears in the shared
  conversation execution flow after the Agent reads it with `job_output`.
  Subagents group by participation: **This turn** (children whose
  latest activity postdates the parent's latest user-authored message,
  running first, most recently active first — a re-invoked continuable child
  bumps back to the top) and **Earlier**, from the `jobs-admin`
  `subagentOverview` recency projection; without it the list degrades to one
  flat running-first list. Subagent cards are borderless content cards
  (background fills distinguish resting/hover/open); a running child's label
  breathes. The child currently opened in the conversation area renders
  dimmed with a "Close from conversation" control in place of the mode·state
  meta (the official breadcrumb path, `sessions.open(parent)`); clicking the
  card still opens its tab. Nested subagents render EXPANDED by default: a
  card whose official catalog entry carries `hasChildren` shows its children
  under a left guide line, recursively, with no click. The chevron collapses
  a branch; which levels are open is derived from the official catalogs
  minus a presentation-only collapsed set, so a branch that gains its first
  descendant opens by itself. Each open level calls the official runtime's
  `sessions.setSubagentCatalogOpen(child, true)` — loading that level's
  `subagentsByParent` catalog and keeping it live while open — and collapse
  or hide releases the subscription (collapsing an ancestor releases every
  deeper level too). The home level itself registers as well while the panel
  is visible: the runtime refreshes only selected or registered catalogs, and
  while the conversation is drilled into a child the home session is neither,
  so this registration keeps top-level rows live through that state. The panel never stores the hierarchy: rows, labels,
  modes, activity bits, and the "expandable" hint all come from the official
  per-parent catalogs. Nested cards open Workbench tabs keyed by their own
  session ids (labels survive collapse because the official catalog stays
  loaded), and their instance toolbar jumps through the exact direct-parent
  address found in that catalog.
- **Instance** — one subagent child or background job per tab (the Workbench's own
  `WorkbenchPanelTabs`; the instance id is the child session id, the label
  rides `contributePanelInfo`; job ids use a `job:` presentation namespace).
  A subagent body mounts an explicit non-navigating
  `SessionProvider` and invokes the main area's authorized
  `conversation.session` renderer in `transcriptOnly` form. It therefore uses
  the same complete resident Turn window as the main conversation on first
  open, followed directly by the same official 50-message `hasMore/loadOlder` paging,
  assembler, live stream, Markdown, tool/file/detail actions, typography and
  render-mode preference as the main conversation, but mounts neither a
  composer nor a second render-mode picker.
  An instance-local body toolbar owns status and "Open in conversation";
  Workbench's shared header remains reserved for tabs and panel controls, and
  the body adds no duplicate child title. A child observation lease exists only while
  the tab, panel and document are visible. Hidden tabs mount no Session and do
  no transcript assembly or React commits. Job instances render directly from
  the same official session snapshot as Home and keep Stop in their local
  toolbar. Closing either kind of tab is view-only — the child or job keeps
  running.

The provider owns only disposable render state (tick clock, optimistic
stopping set and overview snapshot); Job and Session lifecycle stay with the
official Runtime stores.
