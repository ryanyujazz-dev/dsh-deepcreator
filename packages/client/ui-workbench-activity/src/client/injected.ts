import type { SessionId, SubagentAddress } from '@deepseek-ai/dsh-client-runtime/client'
import type { JobStopResult, SubagentEventsResult } from '@ryanyujazz/dsh-jobs-admin'

/**
 * Business actions supplied by the slot registration (assembly-owned; React
 * views consume them as plain callbacks and never touch the RPC surface).
 */
export interface ActivityInjected {
  /** Kill one live background job owned by the session (host remote). */
  stopJob(sessionId: SessionId, jobId: string): Promise<JobStopResult>
  /**
   * Read one subagent child's raw event window plus its pending inbox (host
   * remote): full trailing slice without `afterSeq`, deltas with it.
   */
  subagentEvents(
    parentSessionId: SessionId,
    childSessionId: SessionId,
    afterSeq?: number,
  ): Promise<SubagentEventsResult>
  /** Show the child session in the conversation area (official navigation). */
  openInConversation(address: SubagentAddress): void
}
