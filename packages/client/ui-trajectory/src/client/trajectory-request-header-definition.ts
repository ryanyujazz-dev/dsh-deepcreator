import type { Context } from '@deepseek-ai/cordis'
import type {
  ConversationNodeDefinition, RequestPromptInspector, SystemPromptState, SystemPromptInspector,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { trajectoryNode } from './trajectory-definition-common.ts'
import type { TrajectoryRequestHeaderState } from './trajectory-contract.ts'

/** Loaded system surface plus the latest request facts changed by an append or compaction. */
export interface TrajectorySystemMessageState extends SystemPromptState {
  readonly header?: TrajectoryRequestHeaderState
}

function trajectorySystemMessageDefinition(
  inspect: SystemPromptInspector,
): ConversationNodeDefinition<TrajectorySystemMessageState> {
  return {
    kind: 'trajectory-system-message',
    target: 'trajectory',
    match: event => event.type === 'system/message'
      || ('surfaceOp' in event && event.surfaceOp !== 'append')
      ? { id: String(event.seq), role: 'start' }
      : null,
    start: (_context, match, reader) => {
      const prior = reader.previous<TrajectorySystemMessageState>('trajectory-system-message')?.state
      const state = inspect(prior, match.event)
      const node = state.effective
      if (state.uncertain) {
        const header = reader.previous<TrajectoryRequestHeaderState>('trajectory-request-header')?.state
        if (header === undefined) return state
        return {
          ...state,
          header: {
            seq: match.event.seq,
            time: match.event.time,
            location: match.location,
            prompt: { ...header.prompt, system: '' },
          },
        }
      }
      if (node === undefined || node.text === prior?.effective?.text
        || (state.introduced !== undefined && !state.introduced.update)) {
        return { ...state, ...(prior?.header === undefined ? {} : { header: prior.header }) }
      }
      const header = reader.previous<TrajectoryRequestHeaderState>('trajectory-request-header')?.state
      const systemHeader = prior?.header
      const previous = systemHeader !== undefined && (header === undefined || systemHeader.seq > header.seq)
        ? systemHeader
        : header
      if (previous === undefined) return state
      return {
        ...state,
        header: {
          seq: node.seq,
          time: node.time,
          prompt: { ...previous.prompt, system: node.text },
          change: { seq: node.seq, time: node.time, kind: 'system', previous: previous.prompt },
          location: match.location,
        },
      }
    },
    update: context => context.state,
    buildViewNode: (context) => {
      const state = context.state
      if (state?.header !== undefined && state.header.seq === context.start?.event.seq) {
        return trajectoryNode(context, state.header.seq, { kind: 'request-header', header: state.header })
      }
      const prompt = state?.introduced
      return prompt !== undefined && prompt.text !== ''
        && context.start?.event.type === 'system/message' && context.start.event.surfaceOp === 'append'
        ? trajectoryNode(context, prompt.seq, { kind: 'system-prompt', prompt })
        : null
    },
  }
}

function trajectoryRequestHeaderDefinition(
  inspect: RequestPromptInspector,
): ConversationNodeDefinition<TrajectoryRequestHeaderState> {
  return {
    kind: 'trajectory-request-header',
    target: 'trajectory',
    match: event => event.type === 'request/header'
      ? { id: String(event.seq), role: 'start' }
      : null,
    start: (_context, match, reader) => {
      if (match.event.type !== 'request/header') {
        throw new Error('trajectory-request-header start requires request/header')
      }
      const header = reader.previous<TrajectoryRequestHeaderState>('trajectory-request-header')?.state
      const state = reader.previous<TrajectorySystemMessageState>('trajectory-system-message')?.state
      const systemHeader = state?.header
      const previous = systemHeader !== undefined && (header === undefined || systemHeader.seq > header.seq)
        ? systemHeader.prompt
        : header?.prompt
      const inspection = inspect(previous, match.event, state?.effective)
      const change = inspection.change ?? (systemHeader !== undefined
        && (header === undefined || systemHeader.seq > header.seq) ? systemHeader.change : undefined)
      return {
        seq: match.event.seq,
        time: match.event.time,
        prompt: inspection.prompt,
        location: match.location,
        ...(change === undefined ? {} : { change }),
      }
    },
    update: context => context.state,
    buildViewNode: context => context.state === undefined
      ? null
      : trajectoryNode(context, context.state.seq, {
        kind: 'request-header',
        header: context.state,
      }),
  }
}

/** Register Trajectory system-prompt nodes and request-header facts. */
export function registerTrajectoryRequestHeaderDefinition(ctx: Context): void {
  ctx.uiConversation.events.register(trajectorySystemMessageDefinition(
    (previous, event) => ctx.uiConversation.inspectSystemPrompt(previous, event),
  ))
  ctx.uiConversation.events.register(trajectoryRequestHeaderDefinition(
    (previous, event, system) => ctx.uiConversation.inspectRequestPrompt(previous, event, system),
  ))
}
