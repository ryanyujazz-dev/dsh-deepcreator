// ExecFlowBody: the classic/think render-mode body — one stable flow over
// final business Nodes where contiguous tool-call nodes of a turn form ONE
// execution run rendered through ExecutionSlot (a single morphing header,
// expandable body). Plain nodes (messages, commands, context...) cross the
// chat entry's delegated node seat; assistant steps render think content
// per the mode's think form (classic = compact: reasoning hidden so runs
// aggregate across steps; think = inline: reasoning rows expanded in flow,
// runs stay step-scoped). The mode ring owns the picker (session header);
// this body owns the flow, paging, pending steering and bottom-follow.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { ChatRenderSlotProps, ThinkMode } from '../contract/slots.ts'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { ExecutionSlot, type SlotDrafting, type SlotMember } from './ExecutionSlot.tsx'
import { formatRunDuration } from './message-chrome.ts'
import css from './ChatView.module.css'

const FOLLOW_THRESHOLD = 24
const EMPTY_DRAFTING: readonly SlotDrafting[] = []

/**
 * Best-effort target for a drafting file tool (edit/write), parsed from the
 * still-streaming args. Truncated JSON (the path has not arrived yet) yields
 * null, so the drafting row shows the verb alone until the target is known.
 * Only the file NAME shows in the title (`src/foo.ts` → `foo.ts`), matching
 * the settled file rows.
 * @param argsRaw - the streaming tool-call args fragment.
 * @param name - wire tool name (file tools only carry a target).
 * @returns the file name, or null when unknown.
 */
function draftingTarget(argsRaw: string, name: string): string | null {
  if (name !== 'edit' && name !== 'write') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const args = parsed as Record<string, unknown>
  const raw = args['file_path'] ?? args['path']
  if (typeof raw !== 'string' || raw === '') return null
  const slash = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return slash === -1 ? raw : raw.slice(slash + 1)
}

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
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

type ChatScrollPosition = NonNullable<ReturnType<ChatRenderSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Turn-level model activity label retained across first-token, tool, and streaming phases. */
function TurnStatus({ startTime, t, thinkForm, onToggleThinkMode, showThinkSwitch }: {
  /** The running turn's logged `turn/start` time; null falls back to mount
   *  time when that boundary is outside the window. */
  startTime: number | null
  /** The owning mode body's locale seat. */
  t: ChatRenderSlotProps['t']
  /** Active think display form; the Thinking chip switches the mode live. */
  thinkForm: ThinkMode
  onToggleThinkMode: () => void
  /** Only while the model is thinking right now (streaming reasoning blocks). */
  showThinkSwitch: boolean
}) {
  const [mountedAt] = useState(() => Date.now())
  // Anchored to turn/start so a mid-turn reload keeps the real
  // elapsed time and the final footer's Ran-for label matches this clock.
  const anchor = startTime ?? mountedAt
  const [elapsedMs, setElapsedMs] = useState(() => Math.max(0, Date.now() - anchor))
  useEffect(() => {
    const tick = (): void => {
      setElapsedMs(Math.max(0, Date.now() - anchor))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => { clearInterval(id) }
  }, [anchor])
  // Short turns keep the plain label; the clock only appears once the turn
  // has clearly been running for a while.
  const showClock = elapsedMs >= 15_000
  return (
    <div className={css.turnStatus} role="status" aria-live="polite">
      Deep diving...
      {showClock && (
        <span className={css.turnStatusClock} aria-hidden>
          {formatRunDuration(elapsedMs, t)}
        </span>
      )}
      {showThinkSwitch && (
        <button
          type="button"
          className={css.thinkToggle}
          aria-pressed={thinkForm === 'compact'}
          title={thinkForm === 'compact' ? t('execflow.status.showThink') : t('execflow.status.hideThink')}
          onClick={onToggleThinkMode}
        >
          {t('execflow.status.thinking')}
        </button>
      )}
    </div>
  )
}

/** Injected face of the execflow mode bodies: which think form this mode is
 * (classic = compact, think = inline) and the sibling mode to switch to. */
export interface ExecFlowBodyInjected {
  /** Active think display form for this mode's partition and renderers. */
  thinkForm: ThinkMode
  /** The sibling execflow mode id (the Thinking chip switches between them). */
  siblingId: string
}

/** Full props of the execflow mode body. */
export type ExecFlowBodyProps = ChatRenderSlotProps & ExecFlowBodyInjected

/**
 * The classic/think render-mode body: pure component over the composed
 * props; each flow entry is a business Node (through the chat entry's
 * delegated keyed seat) or an aggregated tool run (through ExecutionSlot).
 */
export function ExecFlowBody({
  useSession, useSessions, useStore, sessionId, openFile, loadOlder, loadImage, inspectCall, chatScroll, forkAt,
  fileMentions, selectRenderMode, renderSlot, t, actions, thinkForm, siblingId,
}: ExecFlowBodyProps) {
  const order = useSession(s => s.chat.order)
  const nodeStore = useSession(s => s.chat.nodes)
  const timeline = useSession(s => s.chat.timeline)
  const inbox = useSession(s => s.queue)
  // Workspace root off the session list row: path summaries display relative to it.
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const running = useSession(s => s.running)
  const openState = useSession(s => s.openState)
  const openError = useSession(s => s.openError)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)

  const pendingSteering = useMemo(
    () => inbox.filter(item => item.placement === 'steering'),
    [inbox],
  )
  const runningTurnStart = useMemo(() => runningTurnStartTime(timeline), [timeline])

  const partial = useSession(s => s.partial)
  // Drafting signature: names+count of the partial's tool-call blocks. The
  // partition only cares about THIS shape — text deltas inside the partial
  // change the object identity every token but never the signature, so the
  // O(entries) rescan below runs only when a drafting block actually appears,
  // renames, or lands.
  const partialDrafting = useMemo(() => {
    if (partial === null) return { list: EMPTY_DRAFTING, turn: null as number | null }
    const list: SlotDrafting[] = []
    partial.blocks.forEach((block, index) => {
      if (block.kind === 'tool-call' && block.name !== '') {
        list.push({ name: block.name, index, target: draftingTarget(block.argsRaw, block.name) })
      }
    })
    return { list, turn: partial.turn }
  }, [partial])
  const draftingList = partialDrafting.list
  const draftingTurn = partialDrafting.turn

  // ExecFlow single-slot partitioning: contiguous tool-call nodes form one
  // execution run rendered through ExecutionSlot (one morphing header,
  // expandable body). The anchor depends on the think form — inline: a node
  // splits runs whenever it renders ANY visible flow content (think rows
  // included), so runs stay step-scoped; compact: think renders nothing, so
  // only content-bearing nodes (text/images, user bubbles, errors) split —
  // runs aggregate across steps between content anchors.
  const flow = useMemo(() => {
    type Entry =
      | { kind: 'node'; nodeKey: string }
      | { kind: 'run'; turn: number | null; seq: number; members: SlotMember[]; stepStart: number | null; stepEnd: number | null }
    const entries: Entry[] = []
    let runSeq = 0
    const toolNameOf = (nodeKey: string): string | undefined => {
      const node = nodeStore.get(nodeKey)
      if (node === undefined || node.kind !== 'tool-call') return undefined
      const root = (node.data as { root?: object }).root
      if (root === undefined || typeof root !== 'object') return ''
      // Running form carries `name`; the settled ToolResultNode carries it
      // under `call.name`. Both are run members.
      if (!('kind' in root)) {
        const name = (root as { name?: unknown }).name
        return typeof name === 'string' ? name : ''
      }
      const call = (root as { call?: { name?: unknown } }).call
      return typeof call?.name === 'string' ? call.name : ''
    }
    const runningOf = (nodeKey: string): boolean => {
      const node = nodeStore.get(nodeKey)
      if (node === undefined || node.kind !== 'tool-call') return false
      const root = (node.data as { root?: object }).root
      return root !== undefined && typeof root === 'object' && !('kind' in root)
    }
    /** Whether one assistant-step node renders visible flow content in the
     * active think form (its tool-call blocks never render inline). */
    const stepHasVisibleContent = (nodeKey: string): boolean => {
      const node = nodeStore.get(nodeKey)
      if (node === undefined || node.kind !== 'assistant-step') return true
      const blocks = (node.data as { blocks: readonly { kind: string }[] }).blocks
      // Compact form: reasoning renders nothing, so a reasoning-only step is
      // transparent — its tools merge with the surrounding run.
      return thinkForm === 'inline'
        ? blocks.some(block => block.kind !== 'tool-call')
        : blocks.some(block => block.kind !== 'tool-call' && block.kind !== 'reasoning')
    }
    for (const nodeKey of order) {
      const node = nodeStore.get(nodeKey)
      const name = node !== undefined ? toolNameOf(nodeKey) : undefined
      const isTool = name !== undefined
      const last = entries[entries.length - 1]
      const location = node?.location
      const turn = location?.kind === 'step' || location?.kind === 'turn'
        ? location.turn.turn
        : null
      const lastRun = last?.kind === 'run' ? last : undefined
      const lastMember = lastRun?.members[lastRun.members.length - 1]
      // Content anchor: a run extends through nodes that are invisible in the
      // active form (transparent), and never across a different turn.
      if (isTool && lastRun !== undefined && lastMember !== undefined && turn !== null) {
        const lastLocation = nodeStore.get(lastMember.nodeKey)?.location
        const lastTurn = lastLocation?.kind === 'step' || lastLocation?.kind === 'turn'
          ? lastLocation.turn.turn
          : null
        if (turn === lastTurn) {
          lastRun.members.push({ nodeKey, toolName: name, running: runningOf(nodeKey) })
          continue
        }
      }
      if (isTool) {
        const stepLocation = location?.kind === 'step' ? location.step : undefined
        entries.push({
          kind: 'run',
          turn,
          seq: runSeq++,
          members: [{ nodeKey, toolName: name, running: runningOf(nodeKey) }],
          stepStart: stepLocation?.start?.time ?? null,
          stepEnd: stepLocation?.end?.time ?? null,
        })
        continue
      }
      // A transparent node (think-only assistant step in compact form) neither
      // splits the flow nor renders — skip it entirely so the surrounding runs
      // join. Everything else is a visible anchor that splits runs.
      if (node !== undefined && node.kind === 'assistant-step' && !stepHasVisibleContent(nodeKey)) {
        continue
      }
      entries.push({ kind: 'node', nodeKey })
    }
    // Drafting blocks of the CURRENT partial belong to the streaming step:
    // attach them to the LAST run entry only (a run of the same turn), or —
    // before the first tool/call lands and the run entry exists — carry them
    // as a pending run so the slot can render the drafting header.
    const drafting = draftingList
    let draftingForLastRun = false
    if (drafting.length > 0 && draftingTurn !== null) {
      const last = entries[entries.length - 1]
      const firstMember = last?.kind === 'run' ? last.members[0] : undefined
      if (firstMember !== undefined) {
        const lastLocation = nodeStore.get(firstMember.nodeKey)?.location
        draftingForLastRun = (lastLocation?.kind === 'step' || lastLocation?.kind === 'turn')
          && lastLocation.turn.turn === draftingTurn
      } else {
        // No run yet for the streaming step (the last entry is a plain node or
        // the flow is empty): create a pending (empty) run that renders the
        // drafting header at the flow tail.
        entries.push({ kind: 'run', turn: draftingTurn, seq: runSeq++, members: [], stepStart: null, stepEnd: null })
        draftingForLastRun = true
      }
    }
    return { entries, drafting: draftingForLastRun ? draftingList : [] }
  }, [order, nodeStore, thinkForm, draftingList, draftingTurn])

  /** One member's full row through the node seat (running or settled styling). */
  const renderMember = useCallback((nodeKey: string) => (
    <ChatNodeSeat
      nodeKey={nodeKey}
      thinkMode={thinkForm}
      useSession={useSession}
      selectedCallId={selectedCallId}
      cwd={cwd}
      openFile={openFile}
      inspectCall={inspectCall}
      forkAt={forkAt}
      loadImage={loadImage}
      fileMentions={fileMentions}
      renderSlot={renderSlot}
      t={t}
    />
  ), [useSession, thinkForm, selectedCallId, cwd, openFile, inspectCall, forkAt, loadImage, fileMentions, renderSlot, t])

  const listRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const atBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** Last position delivered or written on the main thread. */
  const observedTopRef = useRef(0)
  /** Paging anchor: semantic row/position at click, updated by reader scrolls
   * while the request is pending and restored after the prepend lands. */
  const anchorRef = useRef<PagingAnchor | null>(null)
  const firstSeqRef = useRef<number | null>(null)
  const openedRef = useRef(false)
  const lastKeyRef = useRef<string | null>(null)
  const lastSteeringIdRef = useRef<string | null>(null)
  /** Flow tip signature — follow-scroll only when this moves, never on a
   *  scroll-driven at-bottom chrome re-render (which would snap inertial
   *  scrolls the rest of the way to the floor). */
  const followSigRef = useRef<string | null>(null)

  const firstKey = order[0]
  const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
  const lastKey = order.at(-1) ?? null
  const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
  const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
  const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

  const toBottom = (el: HTMLElement): void => {
    anchorRef.current = null
    el.scrollTop = el.scrollHeight
    observedTopRef.current = el.scrollTop
    atBottomRef.current = true
    setAtBottom(true)
    chatScroll.save(null)
  }

  useLayoutEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: React attaches the ref before layout effects run. */
    if (local === null) return
    const el = scrollerOf(local)
    // Open completed: jump to the bottom once — unless a scroll position
    // survives from a previous mount (view-tab switch away and back), which
    // is restored instead of snapping the reader back to the floor.
    if (openState === 'open' && !openedRef.current) {
      openedRef.current = true
      const saved = chatScroll.read()
      if (saved === null) {
        toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        observedTopRef.current = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        atBottomRef.current = isAtBottom
        setAtBottom(isAtBottom)
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      firstSeqRef.current = firstSeq
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    // Prepend (head seq decreased): preserve the same settled row at the
    // position established by the reader's latest scroll. This excludes
    // unrelated tail/composer growth while the request was in flight.
    if (anchorRef.current !== null && firstSeq !== null && firstSeqRef.current !== null && firstSeq < firstSeqRef.current) {
      const anchor = anchorRef.current
      anchorRef.current = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      observedTopRef.current = el.scrollTop
      firstSeqRef.current = firstSeq
      /* v8 ignore next -- ?? arm: a prepend adds nodes, so the flow list here is never empty. */
      lastKeyRef.current = lastKey
      lastSteeringIdRef.current = lastSteeringId
      followSigRef.current = followSig
      return
    }
    firstSeqRef.current = firstSeq
    // Own words must be visible: a new trailing user node force-scrolls
    // (send lives in the composer, so arrival is detected here, not armed there).
    const appendedUser = lastKey !== lastKeyRef.current && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== lastSteeringIdRef.current
    const tipMoved = followSigRef.current !== followSig
    lastKeyRef.current = lastKey
    lastSteeringIdRef.current = lastSteeringId
    followSigRef.current = followSig
    // Follow new flow content while pinned; do NOT re-pin on every render
    // merely because atBottomRef is true (scroll threshold → setState → snap).
    if (appendedUser || appendedSteering || (tipMoved && atBottomRef.current)) toBottom(el)
  })

  const onScrollRef = useRef(() => {})
  onScrollRef.current = () => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (local === null) return
    const el = scrollerOf(local)
    // Only reader input may make raw scroll geometry change follow ownership:
    // a delivered position that deviates from the observed-top ledger (every
    // programmatic write records itself there synchronously). This covers
    // wheel, touch, scrollbar, and keyboard alike without naming devices.
    // Browser shrink-clamps land exactly on the floor min and delayed
    // programmatic deliveries land on the ledger itself, so both preserve
    // the current ownership state.
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(observedTopRef.current, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : atBottomRef.current
    if (!movedByReader && isAtBottom) {
      toBottom(el)
      return
    }
    atBottomRef.current = isAtBottom
    setAtBottom(isAtBottom)
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      anchorRef.current = null
    } else if (anchorRef.current !== null && position !== null) {
      anchorRef.current = { key: position.anchorKey, top: position.anchorTop }
    }
    // Continuous save (unmount happens after ref detach, so saving there is
    // too late); pinned-to-bottom clears so a remount keeps following.
    if (isAtBottom) chatScroll.save(null)
    else if (position !== null) chatScroll.save(position)
    observedTopRef.current = el.scrollTop
  }

  // Bind the scroll listener on the resolved scrollport once per mount;
  // reader-input attribution rides the observed-top ledger, not per-device
  // input listeners.
  useEffect(() => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: effect runs after the list node commits. */
    if (local === null) return
    const el = scrollerOf(local)
    const onScroll = (): void => { onScrollRef.current() }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [])

  // The ref starts null and is assigned every render, so the placeholder
  // initializer a function initial value would need never exists.
  const followRef = useRef<(() => void) | null>(null)
  followRef.current = () => {
    const local = listRef.current
    if (local !== null && atBottomRef.current) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      observedTopRef.current = el.scrollTop
      chatScroll.save(null)
    }
  }
  // Streaming, tool disclosures, and other flow changes resize the column;
  // the sticky composer resizes outside it. This observer owns the mode
  // body's dynamic-height follow decisions and writes only while the reader
  // is pinned.
  useEffect(() => {
    const column = columnRef.current
    const local = listRef.current
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { followRef.current?.() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    return () => { observer.disconnect() }
  }, [])

  // A failed/empty page leaves the head unchanged. Once the request leaves
  // its busy state there is no future prepend for the saved anchor to own.
  useEffect(() => {
    if (!loadingOlder) anchorRef.current = null
  }, [loadingOlder])

  const loadOlderAnchored = (): void => {
    const local = listRef.current
    /* v8 ignore next -- ref-null guard: the paging button renders inside the list tree. */
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        anchorRef.current = {
          key: row.dataset.chatAnchorKey,
          top: flowTop(row, el),
        }
      }
    }
    loadOlder()
  }

  return (
    <div className={css.root}>
      <div ref={listRef} className={css.scroll}>
        <div ref={columnRef} className={css.column} data-chat-flow="">
          {openState === 'loading' && <div className={css.hint}>{t('chat.loadingHistory')}</div>}
          {openState === 'error' && openError !== null && (
            <div className={css.openError}>
              {t('chat.loadError', { message: openError.message, code: openError.code })}
            </div>
          )}
          {hasMore && (
            <div className={css.older}>
              <button type="button" disabled={loadingOlder} onClick={loadOlderAnchored}>
                {loadingOlder ? t('loading') : t('chat.loadOlder')}
              </button>
            </div>
          )}
          {flow.entries.map((entry, index) => entry.kind === 'node' ? (
            <ChatNodeSeat
              key={entry.nodeKey}
              nodeKey={entry.nodeKey}
              thinkMode={thinkForm}
              useSession={useSession}
              selectedCallId={selectedCallId}
              cwd={cwd}
              openFile={openFile}
              inspectCall={inspectCall}
              forkAt={forkAt}
              loadImage={loadImage}
              fileMentions={fileMentions}
              renderSlot={renderSlot}
              t={t}
            />
          ) : (
            <ExecutionSlot
              /* Key stability: a landed run keys on its first member; the
                 pending drafting run keys on the partial's turn — the run it
                 BECOMES — so landing the first member keeps the identity (no
                 remount, expansion survives). */
              key={`run:t-${entry.turn ?? 'root'}-${entry.seq}`}
              members={entry.members}
              /* The partial's drafting blocks belong to ONE run — the LAST
                 entry (the partition either matched the partial's turn on
                 the trailing run or created a pending run for it). Feeding
                 them to earlier slots turned every aggregate head into the
                 drafting row while a call was being composed. */
              drafting={index === flow.entries.length - 1 ? flow.drafting : []}
              renderMember={renderMember}
              t={t}
            />
          ))}
          {/* No pending placeholders: questions (ui-user-questions) and approvals
              (ApprovalPanel) both take over the composer, so a flow card would
              double-render the same wait. */}
          {/* Turn-level loading signal: rides the whole running turn (first-token
              wait, tool execution, streaming) so it never flickers per step.
              The Thinking switch shows only while the model is actually
              thinking this moment (streaming reasoning blocks in the partial). */}
          {running && (
            <TurnStatus
              startTime={runningTurnStart}
              t={t}
              thinkForm={thinkForm}
              onToggleThinkMode={() => { selectRenderMode(sessionId, siblingId, actions.setRenderMode) }}
              showThinkSwitch={partial !== null && partial.blocks.some(block => block.kind === 'reasoning')}
            />
          )}
          {pendingSteering.map(item => (
            <PendingSteeringBubble key={item.id} content={item.content} loadImage={loadImage} t={t} />
          ))}
        </div>
        {!atBottom && (
          <div className={css.toBottomSlot}>
            <button
              type="button"
              className={css.toBottom}
              aria-label={t('chat.toBottom')}
              onClick={() => {
                const local = listRef.current
                /* v8 ignore next -- ref-null guard: the button only renders alongside the mounted list. */
                if (local !== null) toBottom(scrollerOf(local))
              }}
            >
              <IconChevronDownOutline14 />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
