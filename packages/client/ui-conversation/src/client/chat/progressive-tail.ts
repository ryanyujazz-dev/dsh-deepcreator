// Activity reuses the complete main renderer, but mounting a cold official
// tail page can otherwise ask React to materialize every historical row in
// one task. Keep a small tail mounted and reveal older, already-assembled
// rows through the renderer's normal history control. This avoids background
// React/layout work after a tab switch while preserving access to every row.
// Main conversation surfaces remain immediate.

import { startTransition, useLayoutEffect, useRef, useState } from 'react'

const INITIAL_ACTIVITY_ROWS = 4
const ACTIVITY_ROWS_PER_REVEAL = 4

export interface ProgressiveTail<T> {
  items: readonly T[]
  complete: boolean
  revealOlder: () => void
}

export function useProgressiveTail<T>(items: readonly T[], surfaceId: string): ProgressiveTail<T> {
  const progressive = surfaceId.startsWith('activity:')
  const [budget, setBudget] = useState(INITIAL_ACTIVITY_ROWS)
  const previousLength = useRef(items.length)
  const wasComplete = budget >= previousLength.current

  // Once a fully materialized live transcript receives a new tail row, keep
  // it complete before paint. The first official history page is deliberately
  // excluded (previous length is below the initial tail budget).
  useLayoutEffect(() => {
    if (progressive && previousLength.current >= INITIAL_ACTIVITY_ROWS && wasComplete && items.length > budget) {
      setBudget(items.length)
    }
    previousLength.current = items.length
  }, [budget, items.length, progressive, wasComplete])

  if (!progressive) return { items, complete: true, revealOlder: () => {} }
  const start = Math.max(0, items.length - budget)
  return {
    items: items.slice(start),
    complete: start === 0,
    revealOlder: () => {
      startTransition(() => {
        setBudget(value => Math.min(items.length, value + ACTIVITY_ROWS_PER_REVEAL))
      })
    },
  }
}
