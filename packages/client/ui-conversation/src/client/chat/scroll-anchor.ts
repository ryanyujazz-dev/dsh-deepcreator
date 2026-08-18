/** Shared scroll-anchoring arithmetic for the chat render modes. */
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatScrollPosition } from '../contract/slots.ts'

/** Row position in scrollport coordinates (viewport-independent). */
export function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
export function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

/** Capture a reflow-resistant reader position from the current rendered window. */
export function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

export function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}
