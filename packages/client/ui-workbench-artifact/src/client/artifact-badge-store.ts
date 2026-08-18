import { useSyncExternalStore } from 'react'

/**
 * Presentation-only "seen" watermark per session: the latest artifact
 * `updatedAt` the user has viewed. Persisted in localStorage so a reload does
 * not re-light the badge for artifacts the user already saw. Owns no business
 * state — the projected snapshot stays authoritative.
 */
const STORAGE_PREFIX = 'dsh.deepcreator.workbench.artifact.seen.'
const listeners = new Set<() => void>()

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

export function readArtifactsSeen(sessionId: string): number {
  const raw = localStorage.getItem(storageKey(sessionId))
  return raw === null ? 0 : Number(raw)
}

export function markArtifactsSeen(sessionId: string, updatedAt: number): void {
  if (updatedAt <= readArtifactsSeen(sessionId)) return
  localStorage.setItem(storageKey(sessionId), String(updatedAt))
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Latest `updatedAt` the user has viewed for one session. */
export function useArtifactsSeen(sessionId: string): number {
  return useSyncExternalStore(subscribe, () => readArtifactsSeen(sessionId))
}
