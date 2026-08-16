/**
 * Queue+coalesce controller for the ExecutionSlot header swap animation.
 *
 * Which swaps animate (slide-up-fade-out / slide-down-fade-in, the prototype
 * rhythm): the run settling back to its aggregate, and one LIVE member
 * displacing another (a newer drafting or running tool taking the header —
 * drafting counts as runtime). Everything else lands instantly: first
 * appearance, a drafting block landing as its own running row (same tool
 * continuing), leaving the aggregate for the next call, and the single form.
 *
 * Concurrency rule (trailing edge): a playing animation is never
 * interrupted. Form changes that arrive mid-flight coalesce into ONE queued
 * transition whose target always re-points at the latest state — so a
 * queued "running B" that finishes before airing retargets straight to the
 * aggregate, and the header never asserts a state that is no longer true.
 * Lag is bounded by one animation duration.
 */
import { useEffect, useRef, useState } from 'react'
import type { SlotDrafting, SlotMember } from './ExecutionSlot.tsx'

/** What the slot's header currently is. The aggregate form carries a content
 * revision (the settled-member count it summarizes): the form KIND alone
 * cannot express "one more tool finished" — without the revision, a settle
 * while the summary is on screen swaps the title text with no beat. */
export type HeaderForm =
  | { kind: 'drafting'; drafting: SlotDrafting }
  | { kind: 'running'; member: SlotMember }
  | { kind: 'aggregate'; rev: number }
  | { kind: 'single' }
  | { kind: 'empty' }

/** One slide phase's duration (mirrored by the CSS keyframes). */
export const HEADER_ANIM_MS = 500

/** The layer state the header renders: resting form + exiting form + generation. */
export interface HeaderLayerState {
  /** The resting (entering) layer's form. */
  readonly shown: HeaderForm
  /** The exiting layer's form; null while idle. */
  readonly outgoing: HeaderForm | null
  /** Bumped per animation start; layers key on it so a chained animation restarts its keyframes. */
  readonly gen: number
}

/** Value identity: drafting by (name, block index), running by node key,
 * aggregate by content revision, kinds otherwise. */
export function sameHeaderForm(a: HeaderForm, b: HeaderForm): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'drafting' && b.kind === 'drafting') {
    return a.drafting.name === b.drafting.name && a.drafting.index === b.drafting.index
  }
  if (a.kind === 'running' && b.kind === 'running') {
    return a.member.nodeKey === b.member.nodeKey
  }
  if (a.kind === 'aggregate' && b.kind === 'aggregate') {
    return a.rev === b.rev
  }
  return true
}

/** Whether a swap plays the slide (call only for forms that differ). */
export function isAnimatedHeaderSwap(prev: HeaderForm, next: HeaderForm): boolean {
  if (prev.kind === 'empty' || next.kind === 'empty') return false
  if (prev.kind === 'single' || next.kind === 'single') return false
  // Settling back to the aggregate is the completion beat, and so is one more
  // tool finishing while the summary is already on screen (the revision
  // changed — the title counts a new member); leaving the aggregate is instant.
  if (next.kind === 'aggregate') {
    return prev.kind === 'drafting' || prev.kind === 'running'
      || (prev.kind === 'aggregate' && prev.rev !== next.rev)
  }
  if (prev.kind === 'aggregate') return false
  // A drafting block landing as its own running row is the same tool continuing.
  if (prev.kind === 'drafting' && next.kind === 'running') return false
  // Remaining live→live swaps are displacements (incl. drafting being displaced).
  return true
}

/** Live prefers-reduced-motion source; queried lazily per decision so both
 *  a mid-session system toggle and late-mounted environments (the query is
 *  not captured at import time) take effect on the next swap. */
let reducedMotionQuery: MediaQueryList | null | undefined

function prefersReducedMotion(): boolean {
  reducedMotionQuery ??= typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
  return reducedMotionQuery?.matches ?? false
}

/**
 * Drive the header layers for one target form stream.
 * @param target - the form derived from the current members + drafting.
 * @returns the layer state to render.
 */
export function useHeaderTransition(target: HeaderForm): HeaderLayerState {
  const [state, setState] = useState<HeaderLayerState>(() => ({ shown: target, outgoing: null, gen: 0 }))
  const stateRef = useRef(state)
  const pendingRef = useRef<HeaderForm | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const onEndRef = useRef<() => void>(() => {})

  const apply = (next: HeaderLayerState): void => {
    stateRef.current = next
    setState(next)
  }

  const begin = (from: HeaderForm, to: HeaderForm): void => {
    apply({ shown: to, outgoing: from, gen: stateRef.current.gen + 1 })
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { onEndRef.current() }, HEADER_ANIM_MS)
  }

  // The animation-end continuation (kept behind a ref so chained starts reuse
  // the latest closure): settle the exiting layer, then service the coalesced
  // pending target — instantly when the class says so, or as the next slide.
  useEffect(() => {
    const onEnd = (): void => {
      const current = stateRef.current
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending === null || sameHeaderForm(current.shown, pending)) {
        if (current.outgoing !== null) apply({ shown: current.shown, outgoing: null, gen: current.gen })
        return
      }
      if (prefersReducedMotion() || !isAnimatedHeaderSwap(current.shown, pending)) {
        apply({ shown: pending, outgoing: null, gen: current.gen })
        return
      }
      begin(current.shown, pending)
    }
    onEndRef.current = onEnd
    return () => { window.clearTimeout(timerRef.current) }
  }, [])

  // The target stream: apply immediately while idle; coalesce while animating.
  useEffect(() => {
    const current = stateRef.current
    if (current.outgoing === null) {
      if (sameHeaderForm(current.shown, target)) return
      if (prefersReducedMotion() || !isAnimatedHeaderSwap(current.shown, target)) {
        apply({ shown: target, outgoing: null, gen: current.gen })
        return
      }
      begin(current.shown, target)
      return
    }
    pendingRef.current = sameHeaderForm(current.shown, target) ? null : target
  }, [target])

  return state
}
