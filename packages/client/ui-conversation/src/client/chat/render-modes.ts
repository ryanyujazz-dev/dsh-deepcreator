/** Shared render-mode resolution for the chat view and session header. */

import type { ViewTab } from '../contract/views.ts'
import {
  DEFAULT_RENDER_MODE, type ConversationRenderMode,
} from '../../submission-settings.ts'

export { DEFAULT_RENDER_MODE } from '../../submission-settings.ts'

/** Stable renderer used when a selected or default registration is unavailable. */
export const NATIVE_RENDER_MODE = 'normal'

/** Return whether one id belongs to the synchronized built-in preference. */
function isPreferenceMode(id: string): id is ConversationRenderMode {
  return id === 'normal' || id === 'classic' || id === 'think'
}

/**
 * Resolve the synchronized built-in preference, then the stable Native fallback.
 * Plugin-defined ids remain session-scoped because they are outside the built-in
 * Settings control.
 */
export function resolveActiveMode(
  modes: readonly ViewTab[],
  selectedId: string | null,
  defaultId: ConversationRenderMode = DEFAULT_RENDER_MODE,
): ViewTab | undefined {
  const requestedId = selectedId !== null && !isPreferenceMode(selectedId)
    ? selectedId
    : defaultId
  return modes.find(mode => mode.id === requestedId)
    ?? modes.find(mode => mode.id === NATIVE_RENDER_MODE)
}
