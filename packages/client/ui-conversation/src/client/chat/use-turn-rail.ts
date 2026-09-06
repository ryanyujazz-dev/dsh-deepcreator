/**
 * Turn-rail wiring for the fork's chat render bodies: merges the loaded
 * window's navigation index with the host `turnOutline` projection, tracks
 * the reading line's active Turn, and lands navigations — loaded marks
 * scroll straight to their row, unloaded ones page history back through the
 * turn's `turn/start` seq first (bounded retries, then a nearest-turn
 * fallback). Official ui-chat implements the same contract inside ChatView;
 * this hook lets the fork's two render-mode bodies share it.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ChatSnapshot, TurnNavigationItem } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { mergeTurnRailItems, type TurnRailItem } from './turn-rail-items.ts'
// Type-only: merges the turnOutline key into SessionProjectionMap for useProjection.
import type {} from '@deepseek-ai/dsh-session-turn-outline/client'

/** Landing top offset below the scrollport's top edge, matching official. */
const LANDING_OFFSET_PX = 24
/** Bottom distance that counts as "reading the latest turn". */
const BOTTOM_EPSILON_PX = 25
/** Upper bound on loadThrough retries while chasing an unloaded turn. */
const JUMP_MAX_PAGES = 40

/** The row element a loaded anchor addresses, or null while unrendered. */
function anchorRow(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** The scroller owning a chat list element (the fork's bodies share this convention). */
function scrollerOf(from: HTMLElement): HTMLElement {
  return from.closest<HTMLElement>('[data-conversation-scroll]') ?? from
}

/** Turn owning the reading line (~20% down the viewport), official's hit-test order. */
function turnAtLine(scroller: HTMLElement): number | null {
  const rect = scroller.getBoundingClientRect()
  const line = rect.top + Math.min(96, rect.height * 0.2)
  const x = rect.left + rect.width / 2
  const hits = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(x, line)
    : []
  for (const hit of hits) {
    const row = hit.closest<HTMLElement>('[data-chat-turn]')
    if (row !== null && scroller.contains(row)) {
      const turn = Number(row.dataset.chatTurn)
      if (Number.isSafeInteger(turn)) return turn
    }
  }
  let nearest: number | null = null
  for (const row of scroller.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
    const top = row.getBoundingClientRect().top
    if (top <= line) {
      const turn = Number(row.dataset.chatTurn)
      if (Number.isSafeInteger(turn)) nearest = turn
    } else break
  }
  return nearest
}

export interface UseTurnRailArgs {
  /** The chat snapshot selector (provides the loaded window's navigation index). */
  useChat: SnapshotSelectorHook<ChatSnapshot>
  /** The session projection seat (`turnOutline`). */
  useProjection: UseProjection
  /** Ref of the chat list element inside the scrollport. */
  listRef: RefObject<HTMLElement | null>
  /** Pages history back until the window covers `seq`; no-op when unavailable. */
  loadThrough: ((seq: SessionSeq) => Promise<void>) | undefined
  /** Whether older history may still page in. */
  hasMore: boolean
  /** Mount the rail only for a live, transcript-bearing body. */
  enabled: boolean
}

export interface TurnRailController {
  items: readonly TurnRailItem[]
  activeTurn: number | null
  busyTurn: number | null
  navigate: (item: TurnRailItem) => void
}

const NO_LOADED_ITEMS: readonly TurnNavigationItem[] = []

export function useTurnRail({ useChat, useProjection, listRef, loadThrough, hasMore, enabled }: UseTurnRailArgs): TurnRailController {
  // Older fixtures and persisted snapshots may predate the navigation index;
  // an absent index degrades to outline-only items.
  const loadedItems = useChat(s => (s.navigation ?? undefined)?.items() ?? NO_LOADED_ITEMS)
  const outline = useProjection('turnOutline')
  const items = useMemo(
    () => mergeTurnRailItems(loadedItems, outline),
    [loadedItems, outline],
  )
  const [activeTurn, setActiveTurn] = useState<number | null>(() => items.at(-1)?.turn ?? null)
  const [busyTurn, setBusyTurn] = useState<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const jumpSeqRef = useRef(0)

  // Active-turn sync: rAF-coalesced on scroll and resize. Near the floor the
  // latest known turn is active; above it the turn at the reading line wins,
  // clamped down to the last rail turn at or before it.
  const syncActiveTurn = useCallback((): void => {
    const list = listRef.current
    if (list === null) return
    const scroller = scrollerOf(list)
    const railItems = items
    if (railItems.length === 0) return
    const latest = railItems.at(-1)?.turn ?? null
    const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_EPSILON_PX
    let next: number | null
    if (atBottom) {
      next = latest
    } else {
      const reading = turnAtLine(scroller)
      next = reading === null
        ? null
        : (railItems.filter(item => item.turn <= reading).at(-1)?.turn ?? railItems[0]!.turn)
    }
    setActiveTurn(current => current === next ? current : next)
  }, [items, listRef])

  useEffect(() => {
    if (!enabled) return
    const schedule = (): void => {
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        syncActiveTurn()
      })
    }
    const list = listRef.current
    if (list === null) return
    const scroller = scrollerOf(list)
    // Scroll + window resize only: the chat body already owns the scroller's
    // single ResizeObserver (pinned follow), and every layout change that
    // moves the reading line (streaming follow, prepend correction, window
    // resize) emits a scroll event or a window resize anyway.
    scroller.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    schedule()
    return () => {
      scroller.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [enabled, syncActiveTurn, listRef])

  const landOnRow = useCallback((row: HTMLElement, turn: number): void => {
    const list = listRef.current
    if (list === null) return
    const scroller = scrollerOf(list)
    const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop += top - LANDING_OFFSET_PX
    setActiveTurn(turn)
  }, [listRef])

  /** Land after paging: retry while the turn stays unloaded and pages remain. */
  const settleJump = useCallback(async (turn: number, seq: SessionSeq, attempt: number): Promise<void> => {
    const list = listRef.current
    if (list === null) { setBusyTurn(null); return }
    const item = items.find(candidate => candidate.turn === turn)
    if (item !== undefined && item.anchor.kind === 'loaded') {
      const row = anchorRow(list, item.anchor.key)
      if (row !== null) {
        landOnRow(row, turn)
        setBusyTurn(null)
        return
      }
    }
    if (item === undefined && hasMore && loadThrough !== undefined && attempt < JUMP_MAX_PAGES) {
      await loadThrough(seq)
      // Let the prepended rows commit before re-testing.
      await new Promise(resolve => { requestAnimationFrame(() => { resolve(null) }) })
      await settleJump(turn, seq, attempt + 1)
      return
    }
    // Exhausted: land on the first rendered turn at or after the target.
    let fallback: HTMLElement | null = null
    for (const row of list.querySelectorAll<HTMLElement>('[data-chat-turn]')) {
      const rowTurn = Number(row.dataset.chatTurn)
      if (Number.isSafeInteger(rowTurn) && rowTurn >= turn) { fallback = row; break }
    }
    if (fallback !== null) landOnRow(fallback, turn)
    setBusyTurn(null)
  }, [hasMore, items, landOnRow, listRef, loadThrough])

  const navigate = useCallback((item: TurnRailItem): void => {
    const list = listRef.current
    if (list === null) return
    if (item.anchor.kind === 'loaded') {
      const row = anchorRow(list, item.anchor.key)
      if (row !== null) landOnRow(row, item.turn)
      return
    }
    if (loadThrough === undefined) return
    const seq = jumpSeqRef.current + 1
    jumpSeqRef.current = seq
    setBusyTurn(item.turn)
    void settleJump(item.turn, item.anchor.seq, 0).finally(() => {
      // A newer jump superseded this one; its own settle owns the busy state.
      if (jumpSeqRef.current === seq) setBusyTurn(current => current === item.turn ? null : current)
    })
  }, [landOnRow, listRef, loadThrough, settleJump])

  return { items, activeTurn, busyTurn, navigate }
}
