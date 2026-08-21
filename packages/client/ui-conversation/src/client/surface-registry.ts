import type { ReactNode } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSessionOwnerProps } from './contract/slots.ts'

/** Authorized renderer captured from the conversation root's session outlet. */
export type ConversationSessionRenderer = (owner: ConversationSessionOwnerProps) => ReactNode

/**
 * UI-only bridge that lets another surface invoke the conversation root's
 * already-authorized session outlet. It carries no Session data; the explicit
 * SessionProvider at the call site supplies the real runtime scope.
 */
export class ConversationSurfaceRegistry implements HostObservable<ConversationSessionRenderer | undefined> {
  private renderer: ConversationSessionRenderer | undefined
  private readonly listeners = new Set<() => void>()
  private sequence = 0

  readonly getSnapshot = (): ConversationSessionRenderer | undefined => this.renderer

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  register(renderer: ConversationSessionRenderer): () => void {
    const sequence = ++this.sequence
    this.renderer = renderer
    this.publish()
    return () => {
      if (this.sequence !== sequence) return
      this.renderer = undefined
      this.publish()
    }
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
