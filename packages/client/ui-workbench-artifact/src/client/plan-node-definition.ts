import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeContext, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { PlanArtifactRecord } from './artifact-contract.ts'

export const EXIT_PLAN_MODE = 'exit_plan_mode'

type PlanNodeState = PlanArtifactRecord

/** Parse only the official exit-plan payload shape; malformed calls stay inert. */
export function planFromArguments(raw: string): { title: string; markdown: string } | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || !('plan' in value)) return null
    const markdown = (value as { plan?: unknown }).plan
    if (typeof markdown !== 'string' || !/^#\s+\S/.test(markdown.trim())) return null
    const title = markdown.split('\n').map(line => /^#{1,6}\s+(.+?)\s*$/.exec(line)?.[1]).find(Boolean) ?? 'Plan'
    return { title, markdown }
  } catch {
    return null
  }
}

/** One Context per plan call, updated by its paired durable result. */
export const planNodeDefinition: ConversationNodeDefinition<PlanNodeState> = {
  kind: 'workbench-plan',
  target: 'plans',
  match: (event) => {
    if (event.type === 'tool/call' && event.data.name === EXIT_PLAN_MODE && planFromArguments(event.data.arguments) !== null) {
      return { id: String(event.data.callId), role: 'start' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.message.source.callId), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'tool/call') throw new Error('plan start requires tool/call')
    const parsed = planFromArguments(match.event.data.arguments)
    if (parsed === null) throw new Error('plan start requires valid exit_plan_mode arguments')
    return {
      callId: String(match.event.data.callId),
      ...parsed,
      status: 'pending',
      turn: match.event.data.turn,
      updatedAt: match.event.time,
      seq: match.event.seq,
    }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    return {
      ...context.state,
      status: match.event.data.message.content[0]?.isError === true ? 'rejected' : 'approved',
      updatedAt: match.event.time,
      seq: match.event.seq,
    }
  },
  buildViewNode: (context: ConversationNodeContext<PlanNodeState>) => {
    if (context.state === undefined) return null
    return {
      key: context.key,
      kind: 'workbench-plan',
      id: context.id,
      target: 'plans',
      anchorSeq: context.state.seq,
      data: context.state,
    }
  },
}

export function registerPlanNodeDefinition(ctx: Context): () => void {
  return ctx.conversationEvents.register(planNodeDefinition)
}
