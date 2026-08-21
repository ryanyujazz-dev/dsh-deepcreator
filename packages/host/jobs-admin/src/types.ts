/** Pure wire types for background-job stop administration. */

export interface JobStopOk {
  ok: true
}

export interface JobStopError {
  ok: false
  code: 'INVALID_SESSION' | 'INVALID_JOB' | 'SESSION_GONE' | 'JOB_NOT_FOUND' | 'NOT_LIVE' | 'KILL_FAILED'
  message: string
}

export type JobStopResult = JobStopOk | JobStopError

/** One catalog child's recency facts for the Activity panel's home grouping. */
export interface SubagentOverviewChild {
  id: string
  /** Store activity bit, the same face the client catalog projects. */
  running: boolean
  /** Epoch ms of the live child's latest logged event; absent for cold children. */
  lastActiveAt?: number
}

/** Recency projection the panel folds into its "this turn" cohort grouping. */
export interface SubagentOverviewOk {
  ok: true
  /**
   * Epoch ms of the parent's latest user-authored surface message — the
   * boundary of the current participation cohort; absent when the parent log
   * carries none.
   */
  turnStartedAt?: number
  children: SubagentOverviewChild[]
}

export interface SubagentOverviewError {
  ok: false
  code: 'INVALID_SESSION' | 'PARENT_GONE' | 'READ_FAILED'
  message: string
}

export type SubagentOverviewResult = SubagentOverviewOk | SubagentOverviewError
