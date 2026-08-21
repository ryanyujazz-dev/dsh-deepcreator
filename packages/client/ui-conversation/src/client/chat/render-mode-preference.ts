/** Host-backed default for sessions without a session-specific render-mode choice. */

import {
  createSnapshotStore, type SessionId, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_RENDER_MODE, DEFAULT_RENDER_MODE_FIELD,
  type ConversationRenderMode, type ConversationSettings,
} from '../../submission-settings.ts'

/** Live default render-mode preference shared by Settings and conversation views. */
export class RenderModePreference {
  /** Reactive preference source. */
  readonly value: SnapshotStore<ConversationRenderMode> = createSnapshotStore(DEFAULT_RENDER_MODE)
  private readonly sessionWriters = new Map<SessionId, Map<(mode: string) => void, number>>()

  /**
   * @param host - Durable conversation settings scope; absent compositions remain process-local.
   */
  constructor(private readonly host?: SettingsScope<ConversationSettings>) {
    if (host === undefined) return
    host.subscribe(() => { this.adopt(host) })
    this.adopt(host)
  }

  /**
   * Publish a new default before starting its durable write.
   * @param mode - Built-in renderer to use when a session has no override.
   * @param currentSessionId - Visible session that should switch immediately, when mounted.
   */
  set(mode: ConversationRenderMode, currentSessionId?: SessionId): void {
    this.publish(mode)
    if (currentSessionId !== undefined) {
      for (const write of this.sessionWriters.get(currentSessionId)?.keys() ?? []) write(mode)
    }
  }

  /**
   * Select a mode from conversation chrome and mirror it to the durable preference.
   * @param _sessionId - Session whose renderer is being changed (kept in the shared mode API).
   * @param mode - Built-in renderer selected by the user.
   * @param write - Session-store action used by the mounted control.
   */
  select(
    _sessionId: SessionId,
    mode: string,
    write: (mode: string) => void,
  ): void {
    if (mode === 'normal' || mode === 'classic' || mode === 'think') this.publish(mode)
    write(mode)
  }

  /**
   * Bind the mounted session store writer used by the Settings row's immediate apply path.
   * @param sessionId - Session whose header and chat share the writer.
   * @param write - Store action that selects the session render mode.
   * @returns disposer that removes only this binding.
   */
  bindSession(sessionId: SessionId, write: (mode: string) => void): () => void {
    const writers = this.sessionWriters.get(sessionId) ?? new Map<(mode: string) => void, number>()
    writers.set(write, (writers.get(write) ?? 0) + 1)
    this.sessionWriters.set(sessionId, writers)
    return () => {
      const leases = writers.get(write) ?? 0
      if (leases <= 1) writers.delete(write)
      else writers.set(write, leases - 1)
      if (writers.size === 0 && this.sessionWriters.get(sessionId) === writers) {
        this.sessionWriters.delete(sessionId)
      }
    }
  }

  /**
   * Publish a changed preference and start its durable write.
   * @param mode - Preference accepted from either synchronized control.
   */
  private publish(mode: ConversationRenderMode): void {
    if (this.value.getSnapshot() === mode) return
    this.value.set(mode)
    void this.host?.set(DEFAULT_RENDER_MODE_FIELD, mode)
  }

  /** Adopt an accepted Host value without writing it back. */
  private adopt(host: SettingsScope<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined || this.value.getSnapshot() === section.defaultRenderMode) return
    this.value.set(section.defaultRenderMode)
  }
}
