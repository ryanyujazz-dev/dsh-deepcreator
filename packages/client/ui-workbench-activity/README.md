# Workbench Activity provider

Registers the `activity` Workbench type and owns two routes:

- **Home** — one vertical page over the current Session's official data
  surfaces: running/finished background jobs (`jobsBySession`, live-ticking
  durations in the official two-unit format, stoppable through the
  `jobs-admin` Host remote) plus the subagent catalog
  (`subagentsByParent`: running first, then settled — this panel is the only
  subagent entry after the header catalog tree retired).
- **Instance** — one subagent child per tab (the Workbench's own
  `WorkbenchPanelTabs`; the instance id is the child session id, the label
  rides `contributePanelInfo`). The body is the conversation area's
  **classic-mode execution flow** rendered through the
  `deepcreator.conversation.embed` slot: raw child events
  (`jobs-admin` → `subagentEvents`, full window then `afterSeq` deltas on a
  2.5s cadence while the child runs and the group is visible) are folded by
  the OFFICIAL `ConversationNodeAssembler` and rendered read-only with the
  shipped node/tool renderers (fixed classic form — no mode ring, no
  composer, no Think switch). Pending parent-appended inbox work renders as
  one floating read-only queue card at the flow tail (QueueDock visuals minus
  every mutation action); intervention goes through the official
  `sessions.openSubagent` jump. Closing a tab is view-only — the child keeps
  running.

The provider owns only disposable render state (tick clock, optimistic
stopping set, poll results); Job and Session lifecycle stay with the
official Runtime stores.
