// Embed engine: drives the OFFICIAL ConversationNodeAssembler over a
// non-current child session's raw event window. The official client only
// opens conversation windows for the current selection; this engine gives the
// Activity panel's embedded flow the same assembled ConversationSnapshot the
// official Session produces — same registries, same Definitions, same `chat`
// view builder — so the classic-mode body renders identically.

import {
  ConversationNodeAssembler, EMPTY_CHAT_SNAPSHOT,
  type ConversationEventInput, type ConversationEventRegistry, type ConversationViewRegistry,
  type ConversationSnapshot, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'

/** The official event union, reached through the assembler's input type. */
type EmbedSessionEvent = ConversationEventInput['event']

/**
 * One child's embeddable conversation window.
 *
 * `push` accepts a raw event batch (the first full window, then polled
 * deltas); the assembler folds it and the synthesized snapshot — including
 * the legacy top-level mirrors StatsLine-style readers expect — is published
 * through uSES semantics. `running` mirrors the catalog's activity bit, the
 * one live fact the durable log cannot express.
 *
 * Registry changes (a plugin loading later) are not replayed here: the
 * official Session rebuilds on them, but an embed mount outlives them only
 * until its next full-window replace, and Definitions load before the panel
 * ever opens a tab in the composed app.
 */
export class ConversationEmbedEngine {
  private readonly assembler: ConversationNodeAssembler
  private readonly listeners = new Set<() => void>()
  private cache: ConversationSnapshot | undefined
  private running = false
  private appended = 0
  /** Highest seq folded so far; every incoming batch is filtered past it. */
  private lastSeq = -1

  constructor(
    events: ConversationEventRegistry,
    views: ConversationViewRegistry,
    private readonly childId: SessionId,
  ) {
    this.assembler = new ConversationNodeAssembler(events, views)
    this.assembler.replaceWindow([], false)
    this.assembler.flush()
  }

  /** Adopt a polled activity bit into the synthetic snapshot. */
  setRunning(running: boolean): void {
    if (this.running === running) return
    this.running = running
    this.cache = undefined
    this.notify()
  }

  /**
   * Fold one event batch, deduplicated by seq. The panel serves a full
   * trailing window on every mount (a tab switch or a running transition
   * re-runs its poll effect), but this engine is cached per child for the app
   * lifetime and owns the folded log — a repeated window degrades to its own
   * delta, so remounts neither duplicate nodes nor lose the persisted view.
   * The first batch on a fresh engine replaces the window; later batches
   * append event by event.
   */
  push(events: readonly EmbedSessionEvent[]): void {
    const fresh = events.filter(event => event.seq > this.lastSeq)
    if (fresh.length === 0) return
    if (this.appended === 0) {
      this.assembler.replaceWindow(fresh.map(event => ({ event, view: undefined })), false)
    } else {
      for (const event of fresh) this.assembler.append({ event, view: undefined })
    }
    this.appended += fresh.length
    this.lastSeq = fresh[fresh.length - 1]!.seq
    this.assembler.flush()
    this.cache = undefined
    this.notify()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): ConversationSnapshot => {
    if (this.cache === undefined) this.cache = this.build()
    return this.cache
  }

  private build(): ConversationSnapshot {
    const chat = this.assembler.get('chat') ?? EMPTY_CHAT_SNAPSHOT
    const legacy = chat.legacy
    return {
      sessionId: this.childId,
      views: this.assembler,
      chat,
      nodes: legacy.nodes,
      turnTimings: legacy.turnTimings,
      turnEnds: legacy.turnEnds,
      partial: legacy.partial,
      runningCalls: legacy.runningCalls,
      pending: [],
      // Queued work renders through the embed's dedicated floating card, fed
      // by the Activity panel's own poll — not through this snapshot.
      queue: [],
      running: this.running,
      subagent: null,
      composerPhase: 'active',
      removed: false,
      openState: 'open',
      openError: null,
      hasMore: false,
      loadingOlder: false,
      promptError: null,
      blank: false,
      lastAgentError: null,
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  dispose(): void {
    this.listeners.clear()
  }
}
