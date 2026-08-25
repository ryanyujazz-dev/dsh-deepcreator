import type { SessionId, SubagentAddress } from '@deepseek-ai/dsh-client-runtime/client'
import type { JobStopResult, SubagentOverviewResult } from '@ryanyujazz/dsh-jobs-admin'

/**
 * Business actions supplied by the slot registration (assembly-owned; React
 * views consume them as plain callbacks and never touch the RPC surface).
 */
export interface ActivityInjected {
  /** Kill one live background job owned by the session (host remote). */
  stopJob(sessionId: SessionId, jobId: string): Promise<JobStopResult>
  /**
   * Read the parent's recency projection (host remote): per-child
   * last-active time plus the current participation cohort's boundary.
   */
  subagentOverview(parentSessionId: SessionId): Promise<SubagentOverviewResult>
  /**
   * Pull one nested level's official direct-child catalog (the same store
   * `subagentsByParent` projects); reused in-flight, safe to re-request.
   */
  refreshSubagents(parentSessionId: SessionId): Promise<void>
  /**
   * Mark one nested level's catalog as consumed live (membership updates flow
   * while open); the official runtime pairs this with `refreshSubagents`.
   */
  setSubagentCatalogOpen(parentSessionId: SessionId, open: boolean): void
  /** Show the child session in the conversation area (official navigation). */
  openInConversation(address: SubagentAddress): void
  /** Leave an addressed child and select its parent as current (official breadcrumb path). */
  closeFromConversation(parentSessionId: SessionId): void
}
