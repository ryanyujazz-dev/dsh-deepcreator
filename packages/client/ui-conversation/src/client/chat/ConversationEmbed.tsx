// Explicit child-session transcript surface. The root adapter changes only
// the SessionProvider address; the strict surface invokes the exact main
// conversation.session outlet and therefore shares runtime assembly,
// pagination, renderers, mode state and typography with the center column.

import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import type { HostObservable, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
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
  return (
    <SessionProvider sessionId={childSessionId} empty={() => null}>
      {() => renderSlot('deepcreator.conversation.embed.surface', { surfaceId })}
    </SessionProvider>
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
