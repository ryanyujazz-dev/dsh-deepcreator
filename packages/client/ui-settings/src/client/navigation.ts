import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

export type SettingsNavigationRequest =
  | { kind: 'open'; sectionId?: string }
  | { kind: 'close' }

export interface SettingsNavigationSnapshot {
  sequence: number
  request: SettingsNavigationRequest | null
}

/** Public presentation-only control used by shortcuts that open Settings. */
export interface SettingsNavigation {
  readonly commands: HostObservable<SettingsNavigationSnapshot>
  open(sectionId?: string): void
  close(): void
}

/**
 * Edge-triggered settings navigation. Commands are not durable state: a newly
 * mounted shell starts at the current sequence and consumes only later user
 * gestures, so an old shortcut click is never replayed after HMR/remount.
 */
export class SettingsNavigationController implements SettingsNavigation {
  readonly #listeners = new Set<() => void>()
  #snapshot: SettingsNavigationSnapshot = { sequence: 0, request: null }

  readonly commands: HostObservable<SettingsNavigationSnapshot> = {
    getSnapshot: () => this.#snapshot,
    subscribe: (listener) => {
      this.#listeners.add(listener)
      return () => { this.#listeners.delete(listener) }
    },
  }

  open(sectionId?: string): void {
    this.#publish({ kind: 'open', ...(sectionId === undefined ? {} : { sectionId }) })
  }

  close(): void { this.#publish({ kind: 'close' }) }

  #publish(request: SettingsNavigationRequest): void {
    this.#snapshot = { sequence: this.#snapshot.sequence + 1, request }
    for (const listener of this.#listeners) listener()
  }
}
