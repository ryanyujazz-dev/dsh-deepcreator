import type { ConversationTimelineSnapshot, ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ArtifactConversationNode, ArtifactsSnapshot, FileArtifactRecord } from './artifact-contract.ts'

type ReplaceInput = {
  readonly nodes: readonly ConversationViewNode[]
  readonly timeline: ConversationTimelineSnapshot
}
type ApplyInput = {
  readonly upserts: readonly ConversationViewNode[]
  readonly timeline: ConversationTimelineSnapshot
}

/**
 * Fold per-turn artifact nodes into one produced-files snapshot: one record
 * per path, the latest production wins, newest first. Deterministic and
 * replayable, so reconnects and older-page prepends converge on the same list.
 */
export class ArtifactsSnapshotBuilder implements ConversationViewBuilder<ArtifactConversationNode, ArtifactsSnapshot> {
  private readonly records = new Map<string, FileArtifactRecord>()

  readonly empty: ArtifactsSnapshot = { records: [] }

  replace(input: ReplaceInput): ArtifactsSnapshot {
    this.records.clear()
    return this.apply({ upserts: input.nodes, timeline: input.timeline })
  }

  apply({ upserts }: ApplyInput): ArtifactsSnapshot {
    for (const node of upserts) {
      const artifact = node as ArtifactConversationNode
      if (artifact.data.kind !== 'turn') continue
      for (const produced of artifact.data.produced) {
        const current = this.records.get(produced.path)
        if (current !== undefined && current.updatedAt >= produced.time) continue
        this.records.set(produced.path, {
          path: produced.path,
          updatedAt: produced.time,
          turn: artifact.data.turn,
        })
      }
    }
    const records = [...this.records.values()].sort((a, b) => b.updatedAt - a.updatedAt)
    return { records }
  }
}

export const artifactsViewDefinition: ConversationViewDefinition<ArtifactConversationNode, ArtifactsSnapshot> = {
  target: 'artifacts',
  create: () => new ArtifactsSnapshotBuilder(),
}

/**
 * Register the view builder against the `artifacts` target.
 *
 * @param ctx - Plugin context receiving the Definition.
 * @returns idempotent disposer.
 */
export function registerArtifactsConversationView(ctx: Context): () => void {
  return ctx.conversationViews.register(artifactsViewDefinition)
}
