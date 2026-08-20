import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView } from '@deepseek-ai/dsh-tools/presentation'
import type { ArtifactTurnData, ProducedPath } from './artifact-contract.ts'

/** Reducer-maintained state of one turn Context. */
interface ArtifactTurnState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, ToolCallView | null>
  readonly produced: readonly ProducedPath[]
  readonly anchorSeq: number
}

/**
 * Files a tool call produces, following the official deliverables rule: a
 * mutation is recognized by render intent, not by tool name — a diff card, or
 * a generic card whose `kind` is `edit` — so a new mutation tool joins by
 * declaring what it does. Reads contribute nothing, deletes leave nothing to
 * open, and failed calls never produce. Mirrors the official ui-deliverables
 * derivation so the panel can never drift from the conversation's own
 * produced-files chips.
 */
function producedPaths(view: ToolCallView | null): string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? []).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') return (view.locations ?? []).map(location => location.path)
  return []
}

/** Per-Turn produced paths visible at one closing Assistant sequence. */
export function producedForClosing(
  data: Readonly<ArtifactTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq || seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  return paths
}

/**
 * Per-turn Context definition: one node per turn, data = the files that
 * turn produced (first-seen order, deduped). Truncated windows stay inert:
 * a turn whose `turn/start` lives in an unloaded older page never
 * materializes, same as the official deliverables projection.
 */
export const artifactNodeDefinition: ConversationNodeDefinition<ArtifactTurnState> = {
  kind: 'workbench-artifact',
  target: 'artifacts',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('artifact turn start requires turn/start')
    return {
      turn: match.event.data.turn,
      calls: new Map(),
      produced: [],
      anchorSeq: match.event.seq,
    }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), match.view?.for === 'call' ? match.view.view : null)
      return { ...context.state, calls, anchorSeq: match.event.seq }
    }
    if (match.event.type !== 'tool/result') return context.state
    if (match.event.data.message.content[0]?.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const additions: ProducedPath[] = producedPaths(context.state.calls.get(callId) ?? null)
      .map(path => ({ path, seq: match.event.seq, time: match.event.time }))
    return additions.length === 0
      ? context.state
      : {
          ...context.state,
          produced: [...context.state.produced, ...additions],
          anchorSeq: match.event.seq,
        }
  },
  buildLocationData: (context, scope) => {
    if (scope !== 'turn' || context.state === undefined) return null
    const value: ArtifactTurnData = {
      kind: 'turn', turn: context.state.turn, produced: context.state.produced,
    }
    return { kind: 'turn', turn: context.state.turn, key: 'workbench-artifact', value }
  },
  buildViewNode: (context: ConversationNodeContext<ArtifactTurnState>) => {
    if (context.state === undefined) return null
    const data: ArtifactTurnData = {
      kind: 'turn',
      turn: context.state.turn,
      produced: context.state.produced,
    }
    return {
      key: context.key,
      kind: 'workbench-artifact',
      id: context.id,
      target: 'artifacts',
      anchorSeq: context.state.anchorSeq,
      data,
    }
  },
}

/**
 * Register the per-turn Context definition.
 *
 * @param ctx - Plugin context receiving the Definition.
 * @returns idempotent disposer.
 */
export function registerArtifactNodeDefinition(ctx: Context): () => void {
  return ctx.conversationEvents.register(artifactNodeDefinition)
}
