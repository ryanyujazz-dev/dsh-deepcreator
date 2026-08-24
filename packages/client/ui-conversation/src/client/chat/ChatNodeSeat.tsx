import { memo, useMemo } from 'react'
import { JsonBlock } from '@ryanyujazz/dsh-client-ui-primitives'
import type {
  ChatNodeOwnerProps, ChatNodeRenderSlot, ChatViewSlotProps, ThinkMode,
} from '../contract/slots.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'
import css from './ChatView.module.css'

interface ChatNodeSeatProps extends ChatNodeOwnerProps {
  readonly nodeKey: string
  /** Active think display form (compact hides reasoning blocks downstream). */
  readonly thinkMode?: ThinkMode | undefined
  readonly useSession: ChatViewSlotProps['useSession']
  readonly renderSlot: ChatNodeRenderSlot
  readonly t: ChatViewSlotProps['t']
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, thinkMode, cwd, openFile, revealChange, inspectCall, forkAt,
  loadImage, renderMessageImages, fileMentions, useSession, renderSlot, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  const turnId = node?.location.kind === 'turn' || node?.location.kind === 'step'
    ? node.location.turn.turn
    : undefined
  const routedRevealChange = useMemo(() => revealChange === undefined
    ? undefined
    : (path: string) => { revealChange(path, turnId) }, [revealChange, turnId])
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      cwd,
      openFile,
      revealChange: routedRevealChange,
      inspectCall,
      forkAt,
      loadImage,
      renderMessageImages,
      fileMentions,
      thinkMode,
    }, [node, cwd, openFile, routedRevealChange, inspectCall, forkAt, loadImage, renderMessageImages, fileMentions, thinkMode])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  return (
    <div
      className={css.flowItem}
      data-chat-anchor-key={routedNode.key}
      data-chat-flow-key={routedNode.key}
      data-chat-flow-kind={routedNode.kind}
    >
      {renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          <JsonBlock
            label={t('message.unknownSurface', { type: routedNode.kind })}
            payload={routedNode.data}
            truncatedLabel={total => t('json.truncated', { total })}
          />
        ),
      })}
    </div>
  )
})
