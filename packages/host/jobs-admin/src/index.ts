import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { inspectApiRemoteSession } from '@deepseek-ai/dsh-api-remotes'
// Type-only: pulls the `agents`/`jobs`/`subagents` Context merges into this program.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session'
import type { JobId } from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-jobs'
import type {
  SubagentEventsResult, SubagentOverviewChild, SubagentOverviewResult, SubagentQueuedItem,
  SubagentWireEvent, JobStopResult,
} from './types.ts'
export type {
  JobStopError, JobStopOk, JobStopResult,
  SubagentEventsError, SubagentEventsOk, SubagentEventsResult, SubagentQueuedItem, SubagentWireEvent,
  SubagentOverviewError, SubagentOverviewOk, SubagentOverviewResult,
} from './types.ts'

/** Official session ids are `session-<uuid>`; reject anything else before touching the registries. */
const SESSION_ID_PATTERN = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/**
 * Catalog child ids are durable session identities; subagent children mint a
 * bare UUID while ordinary sessions carry the `session-` prefix, so both
 * shapes fence here (the lineage check below is the real authorization).
 */
const CHILD_ID_PATTERN = /^(session-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Registry ids are `<kind>-N` with a lowercase kind namespace; the kind map is merge-extensible, so only the shape is fenced here. */
const JOB_ID_PATTERN = /^[a-z][a-z0-9-]*-\d+$/
/** Initial window: the child log's trailing slice served when no `afterSeq`
 * cursor is supplied. Generous because a spawn-in-process child's log begins
 * with the inherited parent-turn seed, which can span hundreds of events
 * before the child's own turns begin. */
const WINDOW_EVENTS = 1200

/**
 * Background-activity administration the official harness does not expose to
 * the Client. `stop` kills one live job owned by one session (owner-scoped
 * list lookup is the authorization fence; the official registry settles the
 * snapshot on its own). `subagentEvents` is the non-activating read channel
 * for the Activity panel's embedded child flow: the official client only
 * opens conversation windows for the CURRENT session, so this serves the raw
 * event window (plus the live child's still-pending inbox) for host-side
 * assembly on the client.
 */
export class JobsAdmin extends TypertRemoteService {
  /** Required services: the official agent, job, subagent, and session registries. */
  static inject = ['agents', 'jobs', 'subagents', 'sessions']

  constructor(ctx: Context) { super(ctx, 'jobs-admin') }

  @Remote('stop')
  async stop(sessionId: string, jobId: string): Promise<JobStopResult> {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      return { ok: false, code: 'INVALID_SESSION', message: `Session id ${sessionId} is not a valid session id.` }
    }
    if (!JOB_ID_PATTERN.test(jobId)) {
      return { ok: false, code: 'INVALID_JOB', message: `Job id ${jobId} is not a valid job id.` }
    }
    const agent = this.ctx.agents.get(sessionId as SessionId)
    if (agent === undefined) {
      return { ok: false, code: 'SESSION_GONE', message: `Session ${sessionId} has no live agent.` }
    }
    // Owner-scoped lookup is the authorization fence: a job id outside this
    // agent's own visible set is indistinguishable from an unknown one.
    const job = this.ctx.jobs.list(agent).find(entry => entry.id === (jobId as JobId))
    if (job === undefined) {
      return { ok: false, code: 'JOB_NOT_FOUND', message: `Job ${jobId} is not owned by this session.` }
    }
    if (job.status !== 'running' && job.status !== 'stopping') {
      return { ok: false, code: 'NOT_LIVE', message: `Job ${jobId} already settled (${job.status}).` }
    }
    try {
      this.ctx.jobs.kill(job.id, agent, 'user-stop')
    } catch (error) {
      return { ok: false, code: 'KILL_FAILED', message: `Kill request failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { ok: true }
  }

  /**
   * Read one subagent child's raw event window plus its pending inbox. The
   * live child's in-memory log and Agent inbox are preferred (freshest); a
   * cold child is inspected through the official non-activating session
   * reader (no live Agent exists, so its queue is empty by construction). The
   * durable direct-parent lineage on the session header is the authorization
   * fence — a child that does not record the requesting parent is refused
   * before any content leaves the host.
   */
  @Remote('subagentEvents')
  async subagentEvents(parentSessionId: string, childSessionId: string, afterSeq?: number): Promise<SubagentEventsResult> {
    if (!SESSION_ID_PATTERN.test(parentSessionId)) {
      return { ok: false, code: 'INVALID_SESSION', message: `Session id ${parentSessionId} is not a valid session id.` }
    }
    if (!CHILD_ID_PATTERN.test(childSessionId)) {
      return { ok: false, code: 'INVALID_CHILD', message: `Session id ${childSessionId} is not a valid session id.` }
    }
    let header: SessionHeader
    let events: readonly SessionEvent[]
    let queue: SubagentQueuedItem[] = []
    const live = this.ctx.sessions.get(childSessionId as SessionId)
    if (live !== undefined) {
      header = live.header
      events = live.events
      const agent = this.ctx.agents.get(childSessionId as SessionId)
      if (agent !== undefined) {
        // FIFO order: step-boundary (steering) work lands before whole turns.
        // Both lists carry runtime-JSON-validated UserMessages; the closed
        // wire projection below is exact (see SubagentQueuedItem.message).
        queue = [
          ...agent.inbox.nextStep.map(message => ({ id: message.id, placement: 'steering' as const, message: message as unknown as SubagentQueuedItem['message'] })),
          ...agent.inbox.nextTurn.map(message => ({ id: message.id, placement: 'queued' as const, message: message as unknown as SubagentQueuedItem['message'] })),
        ]
      }
    } else {
      try {
        const inspected = await inspectApiRemoteSession(this.ctx, childSessionId as SessionId)
        header = inspected.meta
        events = inspected.events
      } catch (error) {
        return { ok: false, code: 'NOT_FOUND', message: `Child session ${childSessionId} is not readable: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    if (header.parentSession !== (parentSessionId as SessionId)) {
      return { ok: false, code: 'FORBIDDEN', message: `Session ${childSessionId} is not a child of ${parentSessionId}.` }
    }
    const totalSeq = events.length === 0 ? -1 : events[events.length - 1]!.seq
    const cursor = afterSeq ?? undefined
    const slice = cursor === undefined
      ? (events.length > WINDOW_EVENTS ? events.slice(events.length - WINDOW_EVENTS) : events)
      : events.filter(event => event.seq > cursor)
    // Session.append validates every payload as lossless JSON, so the closed
    // wire projection is exact (see SubagentWireEvent).
    return { ok: true, events: [...slice] as SubagentWireEvent[], totalSeq, queue }
  }

  /**
   * Recency projection for the Activity panel's home grouping. The official
   * subagent runtime enumerates the parent's durable direct children (the same
   * corpus the client catalog reads); this adds the two facts that corpus does
   * not carry — each live child's latest logged event time, and the parent's
   * latest user-authored surface message as the current participation
   * cohort's boundary. Cold children keep their catalog row but carry no
   * activity time (they cannot have participated since any live turn).
   */
  @Remote('subagentOverview')
  async subagentOverview(parentSessionId: string): Promise<SubagentOverviewResult> {
    if (!SESSION_ID_PATTERN.test(parentSessionId)) {
      return { ok: false, code: 'INVALID_SESSION', message: `Session id ${parentSessionId} is not a valid session id.` }
    }
    const parent = this.ctx.sessions.get(parentSessionId as SessionId)
    if (parent === undefined) {
      return { ok: false, code: 'PARENT_GONE', message: `Session ${parentSessionId} is not live on this host.` }
    }
    let entries: Awaited<ReturnType<typeof this.ctx.subagents.listChildren>>
    try {
      entries = await this.ctx.subagents.listChildren(parentSessionId as SessionId)
    } catch (error) {
      return { ok: false, code: 'READ_FAILED', message: `Subagent enumeration failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    const children: SubagentOverviewChild[] = []
    for (const entry of entries) {
      if (entry.kind !== 'child') continue
      const live = this.ctx.sessions.get(entry.id)
      const lastEvent = live?.events[live.events.length - 1]
      children.push({
        id: entry.id,
        running: entry.activity === 'running',
        ...(lastEvent === undefined ? {} : { lastActiveAt: lastEvent.time }),
      })
    }
    // Cohort boundary: the parent's latest user-authored message. Context and
    // system injections are user/message events too; only source.kind === 'user'
    // marks what the human actually sent this turn.
    let turnStartedAt: number | undefined
    for (let index = parent.events.length - 1; index >= 0; index -= 1) {
      const event = parent.events[index]!
      if (event.type !== 'user/message') continue
      const source = (event.data as { source?: { kind?: unknown } } | null)?.source
      if (source?.kind !== 'user') continue
      turnStartedAt = event.time
      break
    }
    return { ok: true, children, ...(turnStartedAt === undefined ? {} : { turnStartedAt }) }
  }
}

export default JobsAdmin
