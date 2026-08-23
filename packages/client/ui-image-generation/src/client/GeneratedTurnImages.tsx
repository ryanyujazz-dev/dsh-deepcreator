import { useMemo, type CSSProperties } from 'react'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '@ryanyujazz/dsh-client-ui-conversation/client'
import css from './GeneratedTurnImages.module.css'

export interface GeneratedImageActionOwnerProps {
  turn: number
  index: number
  attachment: ImageAttachmentRef
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'deepcreator.image-generation.result.action': {
      kind: 'list'
      scope: 'session'
      owner: GeneratedImageActionOwnerProps
    }
  }
}

function collect(block: ToolCallBlock, refs: Array<{ attachment: ImageAttachmentRef }>): void {
  if ('kind' in block && !block.isError && block.call?.name === 'create_image') {
    for (const content of block.content) if (content.type === 'image') refs.push({ attachment: content.attachment })
  }
  for (const child of block.subCalls) collect(child, refs)
}

type GeneratedTurnImagesProps = PropsRuntime<'deepcreator.conversation.chat.turnMedia'>
  & PropsRenderSlots<'deepcreator.image-generation.result.action'>

export function GeneratedTurnImages({ turn, renderMessageImages, useSession, renderSlot }: GeneratedTurnImagesProps) {
  const snapshot = useSession(value => value)
  const images = useMemo(() => {
    const refs: Array<{ attachment: ImageAttachmentRef }> = []
    for (const key of snapshot.chat.locations.getTurn(turn.turn)) {
      const node = snapshot.chat.nodes.get(key)
      if (node?.kind === 'tool-call') collect((node as ChatNode<'tool-call'>).data.root, refs)
    }
    return refs
  }, [snapshot, turn.turn])
  return images.length === 0 ? null : (
    <div className={css.list} data-generated-turn-images>
      {images.map((image, index) => (
        <div
          key={`${image.attachment.attachmentId}:${index}`}
          className={css.image}
          style={{ '--dsh-generated-image-ratio': `${image.attachment.width} / ${image.attachment.height}` } as CSSProperties}
          data-generated-turn-image
        >
          {renderMessageImages({ images: [image], align: 'start' })}
          {renderSlot('deepcreator.image-generation.result.action', {
            turn: turn.turn,
            index,
            attachment: image.attachment,
          })}
        </div>
      ))}
    </div>
  )
}
