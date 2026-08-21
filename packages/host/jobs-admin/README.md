# DeepCreator Jobs Admin

Host-owned background-activity administration the official harness does not
expose to the Client. Two Typert Remotes:

- `stop` kills a live job owned by one session: it validates the session id
  (UUID) and job id (`<kind>-N` shape), resolves the session's live agent
  (`ctx.agents`), looks the job up through that owner's own `ctx.jobs.list`
  set — the owner-scoped lookup is the authorization fence, so no
  cross-session id can be addressed — refuses already-settled jobs, and
  issues the official registry's synchronous, idempotent
  `ctx.jobs.kill(id, agent, 'user-stop')`. The job snapshot still settles
  through `stopping` to its terminal status on its own; this service
  fabricates no state.
- `subagentOverview` serves the Activity panel's home grouping: the official
  subagent runtime (`ctx.subagents.listChildren`, the same durable corpus the
  client catalog reads) enumerates the parent's direct children, and this adds
  the recency facts that corpus does not carry — each live child's latest
  logged event time (`lastActiveAt`; cold children keep their row but carry no
  time) and the parent's latest user-authored surface message as
  `turnStartedAt`, the boundary of the current participation cohort. The
  parent must be live (`PARENT_GONE` otherwise); enumeration failures fold
  into `READ_FAILED`.
