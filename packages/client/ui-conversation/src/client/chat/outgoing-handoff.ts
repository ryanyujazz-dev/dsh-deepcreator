import { useLayoutEffect, useMemo, type RefObject } from 'react'
import type { PendingOutgoingMessage } from '../input/contract.ts'

/**
 * Keep browser-local echoes in the flow until their official Chat Nodes are
 * part of this render body's committed DOM. The keyed Node wrapper can precede
 * its business renderer during first-send session settling, so the handoff
 * watches for the official user bubble itself rather than the wrapper or data
 * snapshot. A first committed bubble can itself be transient while the new
 * session/render body settles, so retirement requires it to survive two
 * animation frames. CSS owns the overlap between those frames: the official
 * sibling hides the echo atomically, and removal of that sibling reveals it
 * again without waiting for React.
 */
export function useVisibleChatOutgoing(
  pending: readonly PendingOutgoingMessage[] | undefined,
  listRef: RefObject<HTMLDivElement | null>,
  acknowledge: (ids: readonly number[]) => void,
): readonly PendingOutgoingMessage[] {
  const candidates = useMemo(
    () => (pending ?? []).filter(message => message.successor?.source === 'chat'),
    [pending],
  )
  const candidateKey = candidates.map(message => `${String(message.id)}:${message.successor?.id ?? ''}`).join(',')
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null || candidates.length === 0) return
    let firstFrame: number | null = null
    let secondFrame: number | null = null
    const committed = (): number[] => {
      const committedSuccessors = new Set(
        [...list.querySelectorAll<HTMLElement>('[data-chat-message-successor-id]')]
          .map(element => element.dataset.chatMessageSuccessorId)
          .filter((id): id is string => id !== undefined),
      )
      return candidates.filter(message => (
        message.successor?.source === 'chat'
        && committedSuccessors.has(message.successor.id)
      )).map(message => message.id)
    }
    const settle = (): void => {
      if (firstFrame !== null || secondFrame !== null || committed().length === 0) return
      firstFrame = requestAnimationFrame(() => {
        firstFrame = null
        const first = new Set(committed())
        if (first.size === 0) return
        secondFrame = requestAnimationFrame(() => {
          secondFrame = null
          const stable = committed().filter(id => first.has(id))
          if (stable.length > 0) acknowledge(stable)
        })
      })
    }
    const observer = new MutationObserver(settle)
    observer.observe(list, { childList: true, subtree: true })
    settle()
    return () => {
      observer.disconnect()
      if (firstFrame !== null) cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) cancelAnimationFrame(secondFrame)
    }
    // candidateKey is the stable semantic dependency; the array is rebuilt by
    // the projection scan and must not retrigger an unchanged acknowledgement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acknowledge, candidateKey, listRef])
  return pending ?? []
}
