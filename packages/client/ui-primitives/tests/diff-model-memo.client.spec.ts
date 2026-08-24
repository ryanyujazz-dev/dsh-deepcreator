// @vitest-environment jsdom
// The hunk-model memo and progressive snapshot highlighting: row alignment is
// synchronous, full-snapshot Shiki highlighting is scheduled (a queued
// snapshot renders plain text until its job lands), and stable hunk objects
// (parsed once at fetch time by the Review data plane) build once and reuse.

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCachedDiffHunkModel, buildDiffHunkModel, prioritizeSnapshotHighlights, snapshotHighlightKey,
  subscribeSnapshotHighlight, type DiffHunkInput,
} from '@ryanyujazz/dsh-client-ui-primitives'

afterEach(() => { vi.useRealTimers() })

const hunk = (over: Partial<DiffHunkInput> = {}): DiffHunkInput => ({
  path: 'src/a.ts', oldText: 'const value = 1', newText: 'const value = 2', ...over,
})

describe('hunk model memo', () => {
  it('reuses one model per hunk object', () => {
    const input = hunk()
    const first = buildCachedDiffHunkModel(input)
    expect(buildCachedDiffHunkModel(input)).toBe(first)
  })

  it('keeps distinct hunks distinct and leaves the direct builder intact', () => {
    const a = buildCachedDiffHunkModel(hunk())
    const b = buildCachedDiffHunkModel(hunk())
    expect(a).not.toBe(b)
    expect(buildDiffHunkModel(hunk()).rows).toHaveLength(a.rows.length)
  })
})

describe('progressive snapshot highlighting', () => {
  it('renders plain text while a snapshot is queued, then colors in once', async () => {
    vi.useFakeTimers()
    const source = 'const value = 1\nconst value = 2\nconst value = 3'
    const input = hunk({ oldSource: source, newSource: source })
    const plain = buildCachedDiffHunkModel(input)
    expect(plain.rows[0]?.syntax).toEqual([])

    await vi.advanceTimersByTimeAsync(0)
    const colored = buildCachedDiffHunkModel(input)
    expect(colored.rows[0]?.syntax.length).toBeGreaterThan(0)
  })

  it('shares one full-snapshot highlight across hunks of the same file', async () => {
    vi.useFakeTimers()
    const source = 'const value = 1\nconst value = 2\nconst value = 3'
    const input = hunk({ oldSource: source, newSource: source })
    buildCachedDiffHunkModel(input)
    await vi.advanceTimersByTimeAsync(0)
    const first = buildCachedDiffHunkModel(input)
    const second = buildCachedDiffHunkModel(hunk({ oldSource: source, newSource: source }))
    // Same snapshot + language → the identical per-line token arrays, so N
    // hunks of one file tokenize the full source once, not N times.
    expect(first.rows[0]?.syntax.length).toBeGreaterThan(0)
    expect(second.rows[0]?.syntax).toBe(first.rows[0]?.syntax)
    expect(second).not.toBe(first)
  })

  it('notifies only subscribers that own a completed snapshot', async () => {
    vi.useFakeTimers()
    // Distinct sources: the snapshot memo is module-global and earlier cases
    // already highlighted their own strings.
    const source = 'const notified = 1\nconst notified = 2'
    const other = 'const other = true'
    const key = snapshotHighlightKey(source, 'ts')
    const listener = vi.fn()
    const otherListener = vi.fn()
    const unsubscribe = subscribeSnapshotHighlight(listener, new Set([key]))
    const unsubscribeOther = subscribeSnapshotHighlight(otherListener, new Set([snapshotHighlightKey(other, 'ts')]))
    // Queue both snapshots; both complete in this flush (0 ms timers run
    // consecutively), and each subscriber hears exactly its own snapshot —
    // never a broadcast of the other job.
    buildCachedDiffHunkModel(hunk({ oldSource: source, newSource: source }))
    buildCachedDiffHunkModel(hunk({ oldSource: other, newSource: other }))
    prioritizeSnapshotHighlights(new Set([key]))
    await vi.advanceTimersByTimeAsync(0)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(otherListener).toHaveBeenCalledTimes(1)
    unsubscribe()
    unsubscribeOther()
  })
})
