// ChatView: the default conversation view entry. It dispatches the active
// render mode through 'conversation.chat.render' with `only: <mode id>` —
// the shipped `normal` mode (ChatRenderStandard, the stock flow) or any
// mode a plugin registers into the ring. The mode picker lives in the
// session header's tab bar (ChatRenderMenu), not inside the flow. The node
// render seat stays declared here and is delegated to mode bodies through
// the owner share (one declarer per slot).

import { useCallback, useSyncExternalStore } from 'react'
import type { ChatViewSlotProps, MessageImagesOwnerProps } from '../contract/slots.ts'
import { resolveActiveMode } from './render-modes.ts'
import css from './ChatView.module.css'

/**
 * The chat view slot entry: the mode ring's dispatch site. Mode bodies own
 * their scrollports; this frame only hosts whichever body is active.
 */
export function ChatView({
  surfaceId = 'main', useStore, modes, renderSlot,
  openDetails, openFile, revealChange, loadOlder, loadImage, inspectCall, chatScrollFor, forkAt, fileMentions,
  acknowledgeOutgoing,
}: ChatViewSlotProps) {
  useSyncExternalStore(modes.subscribe, modes.version)
  const defaultMode = useSyncExternalStore(modes.defaultMode.subscribe, modes.defaultMode.getSnapshot)
  const modeTabs = modes.list()
  const selectedMode = useStore(s => s.renderMode)
  const active = resolveActiveMode(modeTabs, selectedMode, defaultMode)
  const chatScroll = chatScrollFor(surfaceId)
  const renderMessageImages = useCallback((owner: Omit<MessageImagesOwnerProps, 'loadImage'>) => renderSlot('conversation.message.images', {
    ...owner,
    loadImage,
  }), [loadImage, renderSlot])

  return (
    <div className={css.frame}>
      {active !== undefined && renderSlot('conversation.chat.render', {
        surfaceId,
        renderSlot,
        openDetails,
        openFile,
        revealChange,
        loadOlder,
        loadImage,
        renderMessageImages,
        inspectCall,
        chatScroll,
        forkAt,
        fileMentions,
        acknowledgeOutgoing,
        selectRenderMode: modes.select,
      }, { only: active.id })}
    </div>
  )
}
