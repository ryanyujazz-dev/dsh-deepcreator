import { memo, useMemo } from 'react'
import { JsonBlock } from '@ryanyujazz/dsh-client-ui-primitives'
import type {
  ChatNodeOwnerProps, ChatNodeRenderSlot, ChatViewSlotProps, EmbedNodeDispatch, ThinkMode,
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
  /**
   * Embed mirror: when present, dispatches through the embed node seat
   * (authorization key and occurrence context differ; the owner share is
   * identical). The main chat path never sets it.
   */
  readonly embedRender?: { readonly dispatch: EmbedNodeDispatch } | undefined
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export const ChatNodeSeat = memo(function ChatNodeSeat({
  nodeKey, thinkMode, selectedCallId, cwd, openFile, revealChange, inspectCall, forkAt,
  loadImage, fileMentions, useSession, renderSlot, embedRender, t,
}: ChatNodeSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node as ChatNode | undefined
  const owner = useMemo<ChatNodeOwnerProps | null>(() => node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      revealChange,
      inspectCall,
      forkAt,
      loadImage,
      fileMentions,
      thinkMode,
    }, [node, selectedCallId, cwd, openFile, revealChange, inspectCall, forkAt, loadImage, fileMentions, thinkMode])
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode } as RoutedChatNodeOwner
  if (embedRender !== undefined) {
    return (
      <div
        className={css.flowItem}
        data-chat-anchor-key={routedNode.key}
        data-chat-flow-key={routedNode.key}
        data-chat-flow-kind={routedNode.kind}
      >
        {embedRender.dispatch(routedOwner, {
          entryKey: routedNode.kind,
          hookContext: { nodeKey, useSession },
          fallback: null,
        })}
      </div>
    )
  }
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
