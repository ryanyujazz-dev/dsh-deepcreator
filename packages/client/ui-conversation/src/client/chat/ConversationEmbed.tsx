// ConversationEmbed: the embeddable child execution flow. The Activity panel
// supplies the polled raw event window and pending queue; this entry runs the
// OFFICIAL assembler over the events (via its inject's engine table), then
// renders the shipped classic-mode body (fixed think form, no mode ring, no
// composer) with the child's own snapshot hook overriding the standard kit.
// Pending inbox work renders as one floating read-only queue card over the
// flow tail — the conversation area's QueueDock visuals minus every mutation
// action; intervention belongs to the conversation area via the panel's jump.

import { useEffect, useMemo, useRef } from 'react'
import { useSyncExternalStore } from 'react'
import type { ConversationEventInput, ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { IconQueueOutline14 } from '@ryanyujazz/dsh-client-ui-primitives'
import type {
  ChatScrollPosition, EmbedNodeDispatch,
} from '../contract/slots.ts'
import type { InputActions, InputState } from '../input/contract.ts'
import type { ChatStoreState } from '../contract/views.ts'
import { ExecFlowBody } from './ExecFlowBody.tsx'
import type { ConversationEmbedEngine } from './embed-engine.ts'
import queueCss from '../queue/QueueDock.module.css'
import embedCss from './ConversationEmbed.module.css'

/** Assembly face supplied by the registration's inject (owns the engine table). */
export interface ConversationEmbedInjected {
  engineFor(childSessionId: SessionId): ConversationEmbedEngine
}

export type ConversationEmbedProps = PropsRuntime<'deepcreator.conversation.embed'>
  & PropsRenderSlots<'deepcreator.conversation.embed.node'>
  & ConversationEmbedInjected
  & PropsLocale<'conversation'>

/** Derive the queue card's one-line preview from a raw pending UserMessage. */
export function embedQueuePreview(message: unknown): string {
  const blocks = (message as { content?: unknown } | null)?.content
  if (!Array.isArray(blocks)) return ''
  let text = ''
  for (const block of blocks) {
    const value = block as { type?: unknown; text?: unknown }
    if (value?.type !== 'text' || typeof value.text !== 'string') continue
    if (text !== '') text += '\n'
    text += value.text
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text
}

// Session-standard-kit stubs the chat bodies require by type but never touch
// on the embed path: projections read the CURRENT session's host values and
// the input machine belongs to the composer, which the embed does not render.
const embedUseProjection = (): undefined => undefined
const embedUseInput: SnapshotSelectorHook<InputState> = <S,>(_selector: (state: InputState) => S): S => undefined as S
const embedUseWorkspaces: SnapshotSelectorHook<never> = <S,>(_selector: (state: never) => S): S => undefined as S
const EMBED_INPUT_ACTIONS = {} as InputActions

export function ConversationEmbed({
  childSessionId, events, queue, running,
  renderSlot, engineFor, useSessions, t,
}: ConversationEmbedProps) {
  const engine = engineFor(childSessionId)
  const snapshot = useSyncExternalStore(engine.subscribe, engine.getSnapshot)
  void snapshot

  // The wire carries closed JSON projections; the official assembler accepts
  // the official union. Session.append validated every payload as exact JSON
  // at the source, so this boundary adaptation is faithful by construction.
  useEffect(() => {
    engine.push(events as readonly ConversationEventInput['event'][])
  }, [engine, events])

  useEffect(() => {
    engine.setRunning(running)
  }, [engine, running])

  // Local read-only scrolling state: the shared per-session store stays with
  // the conversation area (one home per fact). Selection never moves in the
  // embed (inspect is inert) and its store persists per session, so the embed
  // selects from one frozen idle state instead of minting an instance.
  const idleState = useMemo<ChatStoreState>(() => ({ selection: null, draft: '', view: null, inspect: null, renderMode: null }), [])
  const useStore = useMemo(() => {
    const hook = <S,>(selector: (state: ChatStoreState) => S): S => selector(idleState)
    return hook
  }, [idleState])
  const actions = useMemo(() => ({
    select: () => {}, setDraft: () => {}, setView: () => {}, setInspect: () => {}, setRenderMode: () => {},
  }), [])
  const scrollPositions = useRef(new Map<SessionId, ChatScrollPosition>())
  const chatScroll = useMemo(() => ({
    save: (position: ChatScrollPosition | null) => {
      if (position === null) scrollPositions.current.delete(childSessionId)
      else scrollPositions.current.set(childSessionId, position)
    },
    read: () => scrollPositions.current.get(childSessionId) ?? null,
  }), [childSessionId])

  // The child's own snapshot hook — the currency the embed node seat's
  // turn-data factory consumes instead of the standard kit (which follows the
  // CURRENT session).
  const useChildSession = useMemo(() => {
    const hook = <S,>(selector: (state: ConversationSnapshot) => S): S => selector(engine.getSnapshot())
    return hook
  }, [engine])
  // Seat boundary adaptation: the embed node seat's generic authorization
  // signature cannot be re-targeted from the chat bodies' call sites, so the
  // binding narrows to the plain dispatch shape once, here (owner and opts
  // shapes are structurally identical between the two seats).
  const dispatch = useMemo<EmbedNodeDispatch>(() => {
    const binding = renderSlot
    return (owner, opts) => binding(
      'deepcreator.conversation.embed.node',
      owner as never,
      opts as never,
    )
  }, [renderSlot])
  const seat = useMemo<{ dispatch: EmbedNodeDispatch }>(() => ({ dispatch }), [dispatch])

  return (
    <div className={embedCss.root}>
      <ExecFlowBody
        useSession={useChildSession}
        useSessions={useSessions}
        useWorkspaces={embedUseWorkspaces}
        useProjection={embedUseProjection}
        useInput={embedUseInput}
        inputActions={EMBED_INPUT_ACTIONS}
        useStore={useStore}
        sessionId={childSessionId}
        openDetails={() => {}}
        openFile={() => {}}
        revealChange={() => {}}
        loadOlder={() => {}}
        loadImage={async () => ''}
        inspectCall={() => {}}
        chatScroll={chatScroll}
        forkAt={() => {}}
        fileMentions={() => undefined}
        selectRenderMode={() => {}}
        renderSlot={renderSlot}
        actions={actions}
        t={t}
        thinkForm="compact"
        siblingId="classic"
        embedNodeSeat={seat}
        lockThinkForm
      />
      {queue.length > 0 && (
        <div className={embedCss.queueFloat}>
          <div className={queueCss.panel}>
            {queue.length > 1 && (
              <div className={queueCss.header}>
                <span className={queueCss.lead} aria-hidden><IconQueueOutline14 /></span>
                <span className={queueCss.count}>{t('queue.count', { n: queue.length })}</span>
              </div>
            )}
            <ul className={queueCss.list}>
              {queue.map(row => (
                <li key={row.id} className={queueCss.row}>
                  {queue.length === 1 && <span className={queueCss.lead} aria-hidden><IconQueueOutline14 /></span>}
                  <span className={queueCss.preview}>{embedQueuePreview(row.message)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
