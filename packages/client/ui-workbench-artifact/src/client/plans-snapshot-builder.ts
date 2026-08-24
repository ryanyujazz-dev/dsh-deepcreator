import type {
  ConversationTimelineSnapshot, ConversationViewBuilder, ConversationViewDefinition, ConversationViewNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { Context } from '@deepseek-ai/cordis'
import type { PlanArtifactRecord, PlanConversationNode, PlansSnapshot } from './artifact-contract.ts'

type ReplaceInput = { readonly nodes: readonly ConversationViewNode[]; readonly timeline: ConversationTimelineSnapshot }
type ApplyInput = { readonly upserts: readonly ConversationViewNode[]; readonly timeline: ConversationTimelineSnapshot }

/** Fold one node per review call into a newest-first current-Session history. */
export class PlansSnapshotBuilder implements ConversationViewBuilder<PlanConversationNode, PlansSnapshot> {
  private readonly records = new Map<string, PlanArtifactRecord>()
  readonly empty: PlansSnapshot = { records: [] }

  replace(input: ReplaceInput): PlansSnapshot {
    this.records.clear()
    return this.apply({ upserts: input.nodes, timeline: input.timeline })
  }

  apply({ upserts }: ApplyInput): PlansSnapshot {
    for (const node of upserts) {
      const plan = node as PlanConversationNode
      if (plan.data.callId === undefined) continue
      this.records.set(plan.data.callId, plan.data)
    }
    return { records: [...this.records.values()].sort((a, b) => b.seq - a.seq) }
  }
}

export const plansViewDefinition: ConversationViewDefinition<PlanConversationNode, PlansSnapshot> = {
  target: 'plans',
  create: () => new PlansSnapshotBuilder(),
}

export function registerPlansConversationView(ctx: Context): () => void {
  return ctx.conversationViews.register(plansViewDefinition)
}
