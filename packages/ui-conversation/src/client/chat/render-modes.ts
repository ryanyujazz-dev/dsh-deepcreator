/** Shared render-mode resolution for the chat view and session header. */

import type { ViewTab } from '../contract/views.ts'

/** The shipped render mode; persisted selections always fall back to it. */
export const DEFAULT_RENDER_MODE = 'normal'

/** Resolve by id and keep stale persisted selections on the stable Native fallback. */
export function resolveActiveMode(modes: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  const requestedId = selectedId ?? DEFAULT_RENDER_MODE
  return modes.find(mode => mode.id === requestedId)
    ?? modes.find(mode => mode.id === DEFAULT_RENDER_MODE)
}
