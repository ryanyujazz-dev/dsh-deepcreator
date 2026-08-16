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
  private readonly sessionWriters = new Map<SessionId, (mode: string) => void>()

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
    if (currentSessionId !== undefined) this.sessionWriters.get(currentSessionId)?.(mode)
  }

  /**
   * Select a mode from conversation chrome and mirror it to the durable preference.
   * @param sessionId - Session whose renderer is being changed.
   * @param mode - Built-in renderer selected by the user.
   * @param write - Session-store action used by the mounted control.
   */
  select(
    sessionId: SessionId,
    mode: string,
    write: (mode: string) => void,
  ): void {
    if (mode === 'normal' || mode === 'classic' || mode === 'think') this.publish(mode)
    write(mode)
    this.sessionWriters.set(sessionId, write)
  }

  /**
   * Bind the mounted session store writer used by the Settings row's immediate apply path.
   * @param sessionId - Session whose header and chat share the writer.
   * @param write - Store action that selects the session render mode.
   * @returns disposer that removes only this binding.
   */
  bindSession(sessionId: SessionId, write: (mode: string) => void): () => void {
    this.sessionWriters.set(sessionId, write)
    return () => {
      if (this.sessionWriters.get(sessionId) === write) this.sessionWriters.delete(sessionId)
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
