import type { ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'

/** One file a turn produced, with the event time that introduced it. */
export interface ProducedPath {
  readonly path: string
  readonly seq: number
  readonly time: number
}

/** Latest materialized payload of one turn Context. */
export interface ArtifactTurnData {
  readonly kind: 'turn'
  readonly turn: number
  readonly produced: readonly ProducedPath[]
}

/** View node published against the `artifacts` target, one per turn. */
export interface ArtifactConversationNode extends ConversationViewNode {
  readonly target: 'artifacts'
  readonly anchorSeq: number
  readonly data: ArtifactTurnData
}

/** One file the session's turns produced (official deliverables fact). */
export interface FileArtifactRecord {
  /** Absolute workspace path the model wrote or edited. */
  readonly path: string
  /** Last event time that produced this path. */
  readonly updatedAt: number
  /** Turn of the latest production. */
  readonly turn: number
}

/** Session-scoped artifact list assembled by the snapshot builder. */
export interface ArtifactsSnapshot {
  /** Live files in production order (updatedAt desc); one entry per path. */
  readonly records: readonly FileArtifactRecord[]
}

/** Stable empty target used before a Session has assembled any artifact node. */
export const EMPTY_ARTIFACTS_SNAPSHOT: ArtifactsSnapshot = {
  records: [],
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated for Artifact/mention consumers. */
    'workbench-artifact': ArtifactTurnData
  }
  interface ConversationViewSnapshotMap {
    /** Live produced-files list consumed by the Workbench Artifact panel. */
    artifacts: ArtifactsSnapshot
  }
}
