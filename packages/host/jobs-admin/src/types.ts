/** Pure wire types for background-job stop administration. */

/**
 * Locally declared lossless-JSON union: the same boundary `Session.append`
 * enforces at runtime, closed and self-contained so the Typert analyzer can
 * walk it without a cross-package type reference.
 */
export type EmbedJsonValue = null | boolean | number | string | EmbedJsonValue[] | { [key: string]: EmbedJsonValue }

export interface JobStopOk {
  ok: true
}

export interface JobStopError {
  ok: false
  code: 'INVALID_SESSION' | 'INVALID_JOB' | 'SESSION_GONE' | 'JOB_NOT_FOUND' | 'NOT_LIVE' | 'KILL_FAILED'
  message: string
}

export type JobStopResult = JobStopOk | JobStopError

/**
 * Closed wire shape of one SessionEvent. The official `SessionEvent` union is
 * merge-extensible (plugins add event kinds), so a Typert boundary cannot
 * carry it directly; `Session.append` runtime-validates every payload as
 * lossless JSON, making this closed projection exact at the wire.
 */
export interface SubagentWireEvent {
  type: string
  seq: number
  time: number
  data: EmbedJsonValue
  /** Surface-envelope extras (only surface-eligible events carry these). */
  surfaceOp?: EmbedJsonValue
  sourceEventSeqs?: number[]
  skipIfUnknown?: boolean
}

/** One still-pending inbox occurrence of a live subagent child (raw message, not yet durable). */
export interface SubagentQueuedItem {
  id: string
  /** 'steering' awaits the next step boundary; 'queued' awaits a whole later turn. */
  placement: 'queued' | 'steering'
  /** The pending UserMessage as lossless JSON (same closed-projection rule as the events). */
  message: EmbedJsonValue
}

/** Raw child-log window for the Activity panel's embedded execution flow. */
export interface SubagentEventsOk {
  ok: true
  /** Contiguous log slice, ascending by seq. */
  events: SubagentWireEvent[]
  /** Highest seq currently in the child's log (-1 for an empty log) — the next poll's `afterSeq`. */
  totalSeq: number
  /** Live child's still-pending inbox (FIFO: steering before queued); empty for a cold child. */
  queue: SubagentQueuedItem[]
}

export interface SubagentEventsError {
  ok: false
  code: 'INVALID_SESSION' | 'INVALID_CHILD' | 'FORBIDDEN' | 'NOT_FOUND' | 'READ_FAILED'
  message: string
}

export type SubagentEventsResult = SubagentEventsOk | SubagentEventsError
