// Explicit child-session transcript surface. A lease (compat observation
// service) keeps the child's scope and history window alive without
// navigating; the renderer's scope binding context — exported by the fork
// renderer patch — is then overridden with the child's materialized standard
// binding, so the strict surface invokes the exact main conversation.session
// outlet and therefore shares runtime assembly, pagination, renderers, mode
// state and typography with the center column.

import { Fragment, useSyncExternalStore } from 'react'
import type { Context } from 'react'
import clsx from 'clsx'
import type { HostObservable, PropsRenderSlots, PropsRuntime, ScopedStandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionLeaseHub } from '@ryanyujazz/dsh-client-compat'
import type { ConversationSessionRenderer } from '../surface-registry.ts'
import rootCss from '../skeleton/ConversationRoot.module.css'
import css from './ConversationEmbed.module.css'

/** Registration-time services for the explicit child surface. */
export interface ConversationEmbedInjected {
  /** Subscribing through the hub acquires the non-navigating lease. */
  leaseSession: SessionLeaseHub['lease']
  /** The child's materialized standard-kit binding (uiSession.resolve). */
  resolveSessionBinding: (sessionId: SessionId) => ScopedStandardSourceBinding | undefined
  /** The renderer's scope binding seat (SlotRegistry.scopeBindingContext). */
  scopeContext: Context<ScopedStandardSourceBinding | null>
}

export type ConversationEmbedProps = PropsRuntime<'deepcreator.conversation.embed'>
  & ConversationEmbedInjected
  & PropsRenderSlots<'deepcreator.conversation.embed.surface'>

export interface ConversationEmbedSurfaceInjected {
  surfaces: HostObservable<ConversationSessionRenderer | undefined>
}

export type ConversationEmbedSurfaceProps = PropsRuntime<'deepcreator.conversation.embed.surface'>
  & ConversationEmbedSurfaceInjected

/** Mount one explicit Session without changing the runtime's current selection. */
export function ConversationEmbed({
  childSessionId, leaseSession, resolveSessionBinding, scopeContext, renderSlot,
}: ConversationEmbedProps) {
  const surfaceId = `activity:${childSessionId}`
  // The lease lives exactly as long as this mount: subscribing retains the
  // child (scope + history window), unsubscribing cools it. Until the first
  // subscription notifies, the binding is not yet materializable — render
  // nothing for that one frame.
  const lease = leaseSession(childSessionId)
  const { leased } = useSyncExternalStore(lease.subscribe, lease.getSnapshot)
  const binding = leased ? resolveSessionBinding(childSessionId) : undefined
  if (binding === undefined) return null
  return (
    // Keyed by session: re-addressing the embed remounts the shared surface
    // so per-session state (scroll memory, render mode, drafts) resets.
    <Fragment key={childSessionId}>
      <scopeContext.Provider value={binding}>
        {renderSlot('deepcreator.conversation.embed.surface', { surfaceId })}
      </scopeContext.Provider>
    </Fragment>
  )
}

/** Strict-session shell: shared mode control plus the authorized main body. */
export function ConversationEmbedSurface({
  sessionId, surfaceId, surfaces,
}: ConversationEmbedSurfaceProps) {
  const renderSession = useSyncExternalStore(surfaces.subscribe, surfaces.getSnapshot)

  return (
    <div
      className={clsx(rootCss.root, css.root)}
      data-phase="active"
      data-session-id={sessionId}
      data-transcript-surface="activity"
    >
      <div className={css.body}>
        {renderSession?.({ surfaceId, transcriptOnly: true })}
      </div>
    </div>
  )
}
