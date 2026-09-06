import type { Context } from '@deepseek-ai/cordis'
import {
  type ConversationNodeContext,
  type ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  isAppendSurfaceEvent,
} from '@deepseek-ai/dsh-session/surface'

import type { ArtifactTurnData, ProducedPath } from './artifact-contract.ts'

/** Reducer-maintained state of one turn Context. */
interface ArtifactTurnState {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string | null>
  readonly produced: readonly ProducedPath[]
  readonly anchorSeq: number
}

/**
 * Extract the produced path from a supported first-party mutation call. The
 * 0.1.2 conversation Match no longer carries the host's presentation view, so
 * the mutation is recognized from the wire call itself — the same vocabulary
 * the official ui-deliverables derivation uses, so the panel can never drift
 * from the conversation's own produced-files chips. Reads contribute nothing,
 * deletes leave nothing to open, and failed calls never produce.
 * @param name - wire tool name.
 * @param argsRaw - model-produced JSON arguments.
 * @returns the mutation path, or null when the call is not a supported mutation.
 */
function mutationPath(name: string, argsRaw: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(argsRaw) as unknown
  } catch {
    return null
  }
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null
  const record = args as Readonly<Record<string, unknown>>
  switch (name) {
    case 'write':
      return typeof record.content === 'string' ? pathValue(record.file_path) : null
    case 'edit':
      return validEditArgs(record) ? pathValue(record.file_path) : null
    case 'str_replace_editor':
      return editorMutationPath(record)
    default:
      return null
  }
}

/** Validate the fields that an `edit` execution requires. */
function validEditArgs(args: Readonly<Record<string, unknown>>): boolean {
  return typeof args.old_string === 'string'
    && args.old_string.length > 0
    && typeof args.new_string === 'string'
    && args.old_string !== args.new_string
    && (args.replace_all === undefined || typeof args.replace_all === 'boolean')
}

/** Extract a path only from a complete mutating editor command. */
function editorMutationPath(args: Readonly<Record<string, unknown>>): string | null {
  const path = pathValue(args.path)
  if (path === null) return null
  switch (args.command) {
    case 'create':
      return typeof args.file_text === 'string' ? path : null
    case 'str_replace':
      return typeof args.old_str === 'string'
        && args.old_str.length > 0
        && (args.new_str === undefined || typeof args.new_str === 'string')
        ? path
        : null
    case 'insert':
      return typeof args.insert_line === 'number'
        && Number.isInteger(args.insert_line)
        && (args.insert_line as number) >= 0
        && typeof args.new_str === 'string'
        ? path
        : null
    default:
      return null
  }
}

/** A non-blank path preserves the exact spelling supplied to the tool. */
function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
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
      calls.set(String(match.event.data.callId), mutationPath(match.event.data.name, match.event.data.arguments))
      return { ...context.state, calls, anchorSeq: match.event.seq }
    }
    if (match.event.type !== 'tool/result') return context.state
    if (match.event.data.message.content[0]?.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const path = context.state.calls.get(callId) ?? null
    const additions: ProducedPath[] = path === null
      ? []
      : [{ path, seq: match.event.seq, time: match.event.time }]
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
  return ctx.uiConversation.events.register(artifactNodeDefinition)
}
