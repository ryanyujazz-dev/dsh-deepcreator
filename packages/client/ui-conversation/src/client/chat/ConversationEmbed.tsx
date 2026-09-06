// Explicit child-session transcript surface. The root adapter changes only
// the SessionProvider address; the strict surface invokes the exact main
// conversation.session outlet and therefore shares runtime assembly,
// pagination, renderers, mode state and typography with the center column.

import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { HostObservable, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConversationSessionRenderer } from '../surface-registry.ts'
import rootCss from '../skeleton/ConversationRoot.module.css'
import css from './ConversationEmbed.module.css'

export type ConversationEmbedProps = PropsRuntime<'deepcreator.conversation.embed'>
  & PropsRenderSlots<'deepcreator.conversation.embed.surface'>

export interface ConversationEmbedSurfaceInjected {
  surfaces: HostObservable<ConversationSessionRenderer | undefined>
}

export type ConversationEmbedSurfaceProps = PropsRuntime<'deepcreator.conversation.embed.surface'>
  & ConversationEmbedSurfaceInjected

/** Mount one explicit Session without changing the runtime's current selection. */
export function ConversationEmbed({
  childSessionId, SessionProvider, renderSlot,
}: ConversationEmbedProps) {
  const surfaceId = `activity:${childSessionId}`
  // Fork-only session address: the official 0.1.2 standard session seat
  // (`SessionAreaProps`) binds the runtime's CURRENT session only, while the
  // fork runtime's area provider additionally reads an explicit `sessionId`
  // and a render-prop `children`. The localized cast keeps that fork runtime
  // contract expressible until an official addressed provider exists.
  const AddressedSessionProvider = SessionProvider as unknown as (props: {
    sessionId: SessionId
    empty: () => null
    children: () => ReactNode
  }) => ReactNode
  return (
    <AddressedSessionProvider sessionId={childSessionId} empty={() => null}>
      {() => renderSlot('deepcreator.conversation.embed.surface', { surfaceId })}
    </AddressedSessionProvider>
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
