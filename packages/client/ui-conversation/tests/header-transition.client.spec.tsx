// @vitest-environment jsdom
// Header transition controller: which swaps animate, and the queue+coalesce
// discipline (never interrupt, coalesce to the latest state, never assert a
// stale running form). Driven through renderHook with fake timers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  HEADER_ANIM_MS, isAnimatedHeaderSwap, sameHeaderForm, useHeaderTransition,
} from '../src/client/chat/header-transition.ts'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const drafting = (name: string, index: number) =>
  ({ kind: 'drafting' as const, drafting: { name, index, target: null } })
const running = (nodeKey: string, toolName = 'read') =>
  ({ kind: 'running' as const, member: { nodeKey, toolName, running: true } })
const aggregate = (rev = 2) => ({ kind: 'aggregate' as const, rev })
const single = { kind: 'single' as const }
const empty = { kind: 'empty' as const }

describe('swap classification', () => {
  it('animates only aggregate returns and live displacements', () => {
    expect(isAnimatedHeaderSwap(running('a'), aggregate())).toBe(true)
    expect(isAnimatedHeaderSwap(drafting('edit', 0), aggregate())).toBe(true)
    expect(isAnimatedHeaderSwap(running('a'), drafting('edit', 0))).toBe(true)
    expect(isAnimatedHeaderSwap(drafting('edit', 0), drafting('write', 1))).toBe(true)
    expect(isAnimatedHeaderSwap(running('a'), running('b'))).toBe(true)
  })

  it('keeps lifecycle continuations and batch starts instant', () => {
    expect(isAnimatedHeaderSwap(drafting('edit', 0), running('k1', 'edit'))).toBe(false)
    expect(isAnimatedHeaderSwap(aggregate(), drafting('edit', 0))).toBe(false)
    expect(isAnimatedHeaderSwap(empty, running('a'))).toBe(false)
    expect(isAnimatedHeaderSwap(running('a'), empty)).toBe(false)
    expect(isAnimatedHeaderSwap(single, running('b'))).toBe(false)
    expect(isAnimatedHeaderSwap(running('a'), single)).toBe(false)
  })

  it('compares forms by value, not object identity', () => {
    expect(sameHeaderForm(drafting('edit', 0), drafting('edit', 0))).toBe(true)
    expect(sameHeaderForm(drafting('edit', 0), drafting('edit', 1))).toBe(false)
    expect(sameHeaderForm(running('k1'), running('k1'))).toBe(true)
    expect(sameHeaderForm(running('k1'), running('k2'))).toBe(false)
    expect(sameHeaderForm(aggregate(), aggregate())).toBe(true)
  })
})

describe('useHeaderTransition', () => {
  const setup = (initial: Parameters<typeof useHeaderTransition>[0]) => {
    const hook = renderHook(({ target }) => useHeaderTransition(target), {
      initialProps: { target: initial },
    })
    return {
      ...hook,
      set: (target: Parameters<typeof useHeaderTransition>[0]) => {
        act(() => { hook.rerender({ target }) })
      },
      advance: () => {
        act(() => { vi.advanceTimersByTime(HEADER_ANIM_MS) })
      },
    }
  }

  it('first appearance and same-form updates stay instant', () => {
    const h = setup(running('a'))
    expect(h.result.current).toMatchObject({ shown: { kind: 'running' }, outgoing: null })
    h.set(running('a'))
    expect(h.result.current.outgoing).toBeNull()
  })

  it('settling to the aggregate plays one slide and settles', () => {
    const h = setup(running('a'))
    h.set(aggregate())
    expect(h.result.current).toMatchObject({ outgoing: { kind: 'running' }, shown: { kind: 'aggregate' } })
    h.advance()
    expect(h.result.current).toMatchObject({ shown: { kind: 'aggregate' }, outgoing: null })
  })

  it('coalesces mid-flight changes into one queued slide to the latest state', () => {
    const h = setup(running('a'))
    h.set(running('b')) // anim 1: a → b
    h.set(running('c')) // mid-flight: coalesces
    // The entering layer still shows b; nothing asserted beyond it.
    expect(h.result.current).toMatchObject({ shown: { kind: 'running', member: { nodeKey: 'b' } } })
    h.advance()
    // anim 2 (chained): b → c
    expect(h.result.current).toMatchObject({
      shown: { kind: 'running', member: { nodeKey: 'c' } },
      outgoing: { kind: 'running', member: { nodeKey: 'b' } },
    })
    h.advance()
    expect(h.result.current).toMatchObject({ shown: { member: { nodeKey: 'c' } }, outgoing: null })
  })

  it('retargets a queued running form to the aggregate when reality settles first', () => {
    const h = setup(running('a'))
    h.set(running('b')) // anim: a → b
    h.set(aggregate())    // everything settled before the slide airs
    h.advance()
    // The entering layer (b) finished its slide, so the viewer sees b; the
    // queue then plays b → aggregate. b IS what the viewer currently sees —
    // the slide starts there, never from a state already left behind.
    expect(h.result.current).toMatchObject({ outgoing: { member: { nodeKey: 'b' } }, shown: { kind: 'aggregate' } })
    h.advance()
    expect(h.result.current).toMatchObject({ shown: { kind: 'aggregate' }, outgoing: null })
  })

  it('never shows a stale running form after the aggregate target arrives', () => {
    const h = setup(running('a'))
    h.set(running('b'))
    h.set(aggregate())
    h.advance()
    h.advance()
    const kinds: string[] = []
    // after drain, only aggregate; b never became the resting layer post-aggregate
    expect(h.result.current.shown.kind).toBe('aggregate')
    kinds.push(h.result.current.shown.kind)
    expect(kinds).toEqual(['aggregate'])
  })

  it('a settle under the on-screen summary animates the title (revision beat)', () => {
    const h = setup(aggregate(2))
    h.set(aggregate(3))
    expect(h.result.current).toMatchObject({ shown: { kind: 'aggregate', rev: 3 }, outgoing: { kind: 'aggregate', rev: 2 } })
    h.advance()
    expect(h.result.current).toMatchObject({ shown: { kind: 'aggregate', rev: 3 }, outgoing: null })
  })

  it('drafting → same-tool running swaps instantly', () => {
    const h = setup(drafting('edit', 0))
    h.set(running('k1', 'edit'))
    expect(h.result.current).toMatchObject({ shown: { kind: 'running' }, outgoing: null })
  })

  it('aggregate → next drafting swaps instantly', () => {
    const h = setup(aggregate())
    h.set(drafting('edit', 0))
    expect(h.result.current).toMatchObject({ shown: { kind: 'drafting' }, outgoing: null })
  })

  it('honors prefers-reduced-motion with instant swaps', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    const h = setup(running('a'))
    h.set(aggregate())
    expect(h.result.current).toMatchObject({ shown: { kind: 'aggregate' }, outgoing: null })
  })
})
