/**
 * SessionInput shell over the pure input machine: the sole machine caller
 * and effect executor. Owns the InputState store (machine state + the queue
 * overlay), the notice channel, and the submit transaction plumbing
 * (adjudicate via the session's InputTriggerController; claim.submit; default
 * sink). Package-private; the hub alone constructs it and wires the scoped
 * event listeners onto it.
 */
import type {
  ClientContext, ConversationSnapshot, ObservableSnapshot, SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ArbitrateKey, ArbitrateOutcome, CommandClaim, ConsumeTokenRequest, PickOutcome,
  ReferenceInsert, InputTriggerController, TokenSpan,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {
  DraftAttachmentId, EditRange, EditSelection, InputActions, InputEffect, InputNotice, InputState,
  PasteComponent, PendingOutgoingMessage, QueuedMessage, SessionInput, SubmitAttempt,
} from './contract.ts'
import type { InputSubmitMode } from '../contract/composer-submission.ts'
import { InputMachine } from './machine.ts'

/** Popup face the shell needs (dismissal only; typed structurally to avoid a value import). */
export interface PopupDismissFace {
  dismiss(): void
}

/**
 * Construction dependencies of one facade. The slash/popup faces are THUNKS: the
 * shell is created inside the sessions provide materialization (before the
 * scope record is queryable), where `slash.sessionOf`/`command.popupFor`
 * cannot resolve yet — resolution defers to first interactive use.
 */
export interface SessionInputDeps {
  /** Session-scope ctx handed to claim.submit transactions. */
  actx: ClientContext
  /** Enter adjudication face resolver; absent/undefined answer = every '/' line falls to the default sink. */
  inputTriggers?: (() => InputTriggerController | undefined) | undefined
  /** PopupSelect shell face resolver (dismissal on submit lock / escape). */
  popup?: (() => PopupDismissFace | undefined) | undefined
  /** Queue read face; overlaid onto InputState.queue (absent = empty). */
  queue?: ObservableSnapshot<readonly QueuedMessage[]> | undefined
  /** Official Session snapshot used to pair local echoes with authoritative successors. */
  authoritative?: ObservableSnapshot<ConversationSnapshot> | undefined
  /**
   * Steer every still-pending queued message into the running turn, in FIFO
   * order (the empty-draft accelerated-Enter gesture); absent = unsupported.
   */
  steerQueue?: (() => void) | undefined
  /** The plain-message sink (send choreography / materialize fork — the hub owns it). */
  defaultSink(text: string, imageIds: readonly DraftAttachmentId[], mode: InputSubmitMode): void
  /** Command-specific image serialization and lifecycle. */
  commandImages: {
    serialize(ids: readonly DraftAttachmentId[]): Promise<readonly {
      mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
      data: string
      name?: string
    }[]>
    release(ids: readonly DraftAttachmentId[]): void
  }
}

/** Guard tier from the machine phase. */
function guardOf(phase: InputState['phase']): 'plain' | 'claimed' | 'frozen' {
  switch (phase) {
    case 'plain': return 'plain'
    case 'claimed': return 'claimed'
    default: return 'frozen' // adjudicating / submitting
  }
}

const EMPTY_QUEUE: readonly QueuedMessage[] = []

/** No-pipeline lexicon: zero text-ref decorations. */
const EMPTY_LEXICON: ReadonlyMap<'/' | '@', readonly string[]> = new Map()

/**
 * The per-session input facade: scoped-event application verbs +
 * setDraft/submit + the published InputState store.
 */
export class SessionInputShell implements SessionInput {
  /** Published machine state + queue overlay (the InputZone currency source). */
  readonly state: SnapshotStore<InputState>
  /** Latest surfaced notice (null after clear); the wiring renders it beside the error strip. */
  readonly notices: SnapshotStore<InputNotice | null> = createSnapshotStore<InputNotice | null>(null)
  /** The public provide-channel action face (one stable identity per session). */
  readonly actions: InputActions = {
    setDraft: (text) => { this.setDraft(text) },
    addImages: ids => this.addImages(ids),
    removeImage: (id) => { this.removeImage(id) },
    pruneImages: (ids) => { this.pruneImages(ids) },
    submit: () => { this.submit('queue') },
  }

  // Real wall clock: the typing-run merge window must actually expire in
  // production (the machine's no-clock default is a constant for pure tests).
  private readonly core = new InputMachine({ now: () => Date.now() })
  private noticeSeq = 0
  private lastDraft = ''
  private imageIds: readonly DraftAttachmentId[] = []
  private pendingOutgoing: readonly PendingOutgoingMessage[] = []
  private outgoingSeq = 0
  /** Queue occurrences currently known to the browser; queue identities need no historical ledger. */
  private observedQueue = new Set<string>()
  /** Durable chat seq is monotonic, so one watermark excludes history-page arrivals without an unbounded Set. */
  private observedChatSeq = -1
  private readonly sourceOffs: Array<() => void> = []
  private disposed = false
  /** Draft persistence mirror (chat store write; receives the clipboard projection, never raw placeholders). */
  private mirrorFn: ((text: string) => void) | undefined

  constructor(private readonly deps: SessionInputDeps) {
    this.state = createSnapshotStore<InputState>(this.compose())
    if (deps.authoritative !== undefined) {
      for (const item of authoritativeMessages(deps.authoritative.getSnapshot())) {
        if (item.source === 'queue') this.observedQueue.add(item.id)
        else this.observedChatSeq = Math.max(this.observedChatSeq, item.seq)
      }
      this.sourceOffs.push(deps.authoritative.subscribe(() => {
        this.reconcileOutgoing(deps.authoritative?.getSnapshot())
        this.publish()
      }))
    } else {
      this.sourceOffs.push(deps.queue?.subscribe(() => { this.publish() }) ?? (() => {}))
    }
  }

  // ---- SessionInput face ----

  /**
   * Single draft write path (all mutation rides machine events).
   * @param text - the full next draft.
   * @param editRange - the DOM-observed edit shape, when the caller knows it
   * (narrows the machine's occurrence math; absent → diff scan).
   */
  setDraft(text: string, editRange?: EditRange): void {
    this.run(this.core.dispatch({ type: 'draft-changed', draft: text, ...(editRange !== undefined ? { editRange } : {}) }))
  }

  /** Append ordered image ids unless an admission transaction is locked. */
  addImages(ids: readonly DraftAttachmentId[]): boolean {
    if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting') return false
    if (ids.length === 0) return true
    this.imageIds = [...this.imageIds, ...ids]
    this.publish()
    return true
  }

  /** Remove one image id from this draft. */
  removeImage(id: DraftAttachmentId): void {
    const next = this.imageIds.filter(candidate => candidate !== id)
    if (next.length === this.imageIds.length) return
    this.imageIds = next
    this.publish()
  }

  /**
   * Keep only image ids that still resolve in the browser attachment registry.
   * @param available - live registry ids.
   */
  pruneImages(available: readonly DraftAttachmentId[]): void {
    const keep = new Set(available)
    const next = this.imageIds.filter(id => keep.has(id))
    if (next.length === this.imageIds.length) return
    this.imageIds = next
    this.publish()
  }

  /**
   * Restore a failed attempt before any images added after its admission.
   * @param ids - failed attempt image ids.
   */
  restoreImages(ids: readonly DraftAttachmentId[]): void {
    const current = new Set(this.imageIds)
    this.imageIds = [...ids.filter(id => !current.has(id)), ...this.imageIds]
    this.publish()
  }

  /**
   * Clear the draft as a successful-send commit: no undo unit is recorded and
   * the undo history is cut, so Ctrl/Cmd-Z cannot resurrect sent content
   * (the command path gets the same discipline from submit-settled success).
   * @param imageIds - admitted image ids to remove from this draft.
   */
  commitSend(imageIds: readonly DraftAttachmentId[]): void {
    const submitted = new Set(imageIds)
    this.imageIds = this.imageIds.filter(id => !submitted.has(id))
    this.run(this.core.dispatch({ type: 'send-committed' }))
  }

  /**
   * Publish one local echo before the Host round trip begins.
   * @returns the input-local identity used to withdraw a rejected attempt.
   */
  beginOutgoing(
    text: string,
    imageNames: readonly string[],
    placement: PendingOutgoingMessage['placement'],
  ): number {
    this.outgoingSeq += 1
    this.pendingOutgoing = [...this.pendingOutgoing, {
      id: this.outgoingSeq,
      text,
      imageNames: [...imageNames],
      placement,
    }]
    this.publish()
    return this.outgoingSeq
  }

  /** Withdraw one local echo after Host rejection; accepted echoes retire from authoritative state. */
  rejectOutgoing(id: number): void {
    const next = this.pendingOutgoing.filter(item => item.id !== id)
    if (next.length === this.pendingOutgoing.length) return
    this.pendingOutgoing = next
    this.publish()
  }

  /**
   * Complete the visual handoff after the owning chat/queue surface committed
   * the authoritative successor. Admission callbacks must not call this: the
   * local row intentionally bridges the gap between admission and paint.
   */
  acknowledgeOutgoing(ids: readonly number[]): void {
    if (ids.length === 0) return
    const acknowledged = new Set(ids)
    const next = this.pendingOutgoing.filter(item => !acknowledged.has(item.id))
    if (next.length === this.pendingOutgoing.length) return
    this.pendingOutgoing = next
    this.publish()
  }

  /** Undo the latest transaction (InputBar intercepts the platform chord). */
  undo(): void {
    this.run(this.core.dispatch({ type: 'undo' }))
  }

  /** Redo the latest undone transaction. */
  redo(): void {
    this.run(this.core.dispatch({ type: 'redo' }))
  }

  /**
   * Paste text over the selection in one transaction, with any hot-snapshot
   * sync matches componentized inside it.
   * @param text - pasted plain text.
   * @param selection - replaced selection in draft coordinates.
   * @param components - sync-matched reference components (disjoint, inside `text`).
   * @param generation - projection generation for late async-upgrade guards.
   */
  pasteBegin(text: string, selection: EditSelection, components?: readonly PasteComponent[], generation?: number): void {
    this.run(this.core.dispatch({
      type: 'paste-begin', text, selection,
      ...(components !== undefined ? { components } : {}),
      ...(generation !== undefined ? { generation } : {}),
    }))
  }

  /** End the live paste-match attempt (caret/selection ops and Slash updates the machine cannot see). */
  invalidatePaste(): void {
    this.run(this.core.dispatch({ type: 'invalidate-paste' }))
  }

  /**
   * Enter adjudication + submit transaction + default sink. Effects fan out
   * from the machine; this method only feeds the event. Lock entry
   * (adjudicating/submitting) force-closes the transient layers: the popup
   * dismisses and the menu tracks frozen.
   */
  submit(mode: InputSubmitMode = 'queue'): void {
    if (this.snapshot.draft.trim() === '' && this.imageIds.length > 0) {
      if (this.snapshot.phase === 'plain') this.deps.defaultSink('', [...this.imageIds], mode)
      return
    }
    this.run(this.core.dispatch({ type: 'enter', mode }))
    const phase = this.snapshot.phase
    if (phase === 'adjudicating' || phase === 'submitting') {
      this.deps.popup?.()?.dismiss()
      this.deps.inputTriggers?.()?.track(this.snapshot.draft, 0, { tier: 'frozen' }, this.snapshot.draftRev)
    }
  }

  /**
   * Feed a draft/caret change through trigger detection (guard derived from
   * the machine phase).
   * @param draft - live draft text.
   * @param caret - caret position in draft coordinates.
   */
  track(draft: string, caret: number): void {
    this.deps.inputTriggers?.()?.track(draft, caret, { tier: guardOf(this.snapshot.phase) }, this.snapshot.draftRev)
  }

  /**
   * Keyboard arbitration while the menu is open.
   * @param key - the intercepted key.
   * @param composing - IME composition guard state.
   * @returns the menu's verdict; 'pass' when no pipeline is mounted.
   */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome {
    return this.deps.inputTriggers?.()?.arbitrate(key, composing) ?? 'pass'
  }

  /**
   * Steer every still-pending queued message into the running turn (the
   * empty-draft accelerated-Enter gesture). Execution belongs to the hub's
   * queue choreography; absent dep = the gesture falls back to the machine's
   * empty-draft no-op.
   */
  steerQueue(): void {
    this.deps.steerQueue?.()
  }

  /**
   * Space adjudication over the controller's hot state.
   * @returns true = a claim/insert was applied — the caller preventDefaults.
   */
  space(): boolean {
    const inputTriggers = this.deps.inputTriggers?.()
    if (inputTriggers === undefined) return false
    const consumed = inputTriggers.onSpace()
    // Machine-driven draft replacement never passes through onChange, so
    // re-track: the caret lands after the token, where detection sees
    // whitespace and closes the menu.
    if (consumed) {
      const next = this.snapshot
      inputTriggers.track(next.draft, next.draft.length, { tier: guardOf(next.phase) }, next.draftRev)
    }
    return consumed
  }

  /** Dismiss the popupSelect shell (any interaction outside the box). */
  dismissPopup(): void {
    this.deps.popup?.()?.dismiss()
  }

  /**
   * Hot plain-text reference lexicon source for the decoration scan
   * (the plain-text-reference decision;
   * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
   * delegates to the controller's aggregated store. Stable
   * identity per shell; without a pipeline the snapshot is the empty Map and
   * subscribers never fire.
   */
  readonly lexicon: ObservableSnapshot<ReadonlyMap<'/' | '@', readonly string[]>> = {
    getSnapshot: () => this.deps.inputTriggers?.()?.lexicon.getSnapshot() ?? EMPTY_LEXICON,
    subscribe: fn => this.deps.inputTriggers?.()?.lexicon.subscribe(fn) ?? (() => {}),
  }

  /**
   * Apply one command claim (scoped begin-command event listener body).
   * @param claim - the command claim from the pick path.
   * @param span - pick-time span snapshot.
   * @returns whether the machine accepted (phase + span CAS passed and the draft mutated).
   */
  beginCommand(claim: CommandClaim, span: TokenSpan): boolean {
    const before = this.core.state.draftRev
    this.run(this.core.dispatch({ type: 'begin-command', claim, span }))
    return this.core.state.phase === 'claimed' && this.core.state.draftRev !== before
  }

  /**
   * Apply one reference insertion (scoped insert-reference event listener body).
   * @param ref - the reference insertion from the pick path.
   * @param span - pick-time span snapshot.
   * @returns whether the machine accepted.
   */
  insertReference(ref: ReferenceInsert, span: TokenSpan): boolean {
    const before = this.core.state.draftRev
    this.run(this.core.dispatch({ type: 'insert-ref', reference: ref, span }))
    return this.core.state.draftRev !== before
  }

  /**
   * Consume one command token after business success (scoped consume-token
   * event listener body). Span guard: revision CAS then splice; bare-token
   * guard: trimmed-draft equality then clear.
   * @param guard - exact span or bare-token guard.
   * @returns whether the token was consumed.
   */
  consumeToken(guard: ConsumeTokenRequest['guard']): boolean {
    const snapshot = this.core.state
    if (guard.kind === 'span') {
      if (guard.span.draftRev !== snapshot.draftRev) return false
      const draft = snapshot.draft
      this.setDraft(draft.slice(0, guard.span.start) + draft.slice(guard.span.end))
      return true
    }
    if (snapshot.draft.trim() !== guard.token) return false
    this.setDraft('')
    return true
  }

  /**
   * Insert plain reference text over the pick-time span (scoped insert-text
   * event listener body; plain-text-reference decision, web-input-machine
   * note). Same CAS-then-splice shape as the
   * consume-token span branch: the machine sees an ordinary draft-changed
   * transaction (one undo step), no occurrence is minted — the chip look is
   * a scan-derived decoration, never state.
   * @param text - the plain reference text to splice in (e.g. `/name `).
   * @param span - pick-time span snapshot (draftRev CAS).
   * @returns whether the text was applied.
   */
  insertText(text: string, span: TokenSpan): boolean {
    const snapshot = this.core.state
    if (span.draftRev !== snapshot.draftRev) return false
    const draft = snapshot.draft
    this.setDraft(draft.slice(0, span.start) + text + draft.slice(span.end))
    return true
  }

  /**
   * Surface a notice from outside the machine (detached command results).
   * @param level - severity tier.
   * @param text - notice body.
   */
  notify(level: 'info' | 'error', text: string): void {
    this.noticeSeq += 1
    this.notices.set({ level, text, seq: this.noticeSeq })
  }

  // ---- wiring-layer extras (not on the frozen SessionInput face) ----

  /** Teardown: abort any in-flight attempt and stop accepting async settlements. */
  dispose(): void {
    this.disposed = true
    for (const off of this.sourceOffs.splice(0)) off()
    this.pendingOutgoing = []
    this.run(this.core.dispatch({ type: 'release' }))
  }

  /** Read the live machine state (guard derivation reads here). */
  get snapshot(): InputState {
    return this.state.getSnapshot()
  }

  /**
   * Bind the draft persistence mirror (chat store write). Adopt-on-bind: the
   * store draft may hold a persisted value from a previous mount; the caller
   * seeds it via setDraft BEFORE binding, and afterwards every machine-adopted
   * draft mirrors out.
   * @param write - store draft write.
   * @returns the unbind disposer.
   */
  bindMirror(write: (text: string) => void): () => void {
    this.mirrorFn = write
    return () => {
      if (this.mirrorFn === write) this.mirrorFn = undefined
    }
  }

  // ---- effect executor ----

  private run(effects: readonly InputEffect[]): void {
    for (const fx of effects) this.execute(fx)
    this.publish()
  }

  private execute(fx: InputEffect): void {
    switch (fx.type) {
      case 'notice': {
        this.noticeSeq += 1
        this.notices.set({ level: fx.level, text: fx.text, seq: this.noticeSeq })
        return
      }
      case 'adjudicate': {
        this.adjudicate(fx.attempt, fx.draft)
        return
      }
      case 'begin-submit': {
        this.beginSubmit(fx.attempt, fx.claim, fx.args)
        return
      }
      case 'default-sink': {
        this.sinkSerialized(fx.draft, fx.mode)
        return
      }
      default:
        return // machine-internal effects (mirror rides publish)
    }
  }

  /**
   * Prompt serialization before the sink: expand each
   * placeholder to its owner's model form via the session controller's
   * codec routing. Owner missing / serialize failure / disposal blocks the
   * send — notice + draft and chips retained, never a silent downgrade to
   * the clipboard text. Chip-free drafts skip the async detour.
   */
  private sinkSerialized(draft: string, mode: InputSubmitMode): void {
    const imageIds = [...this.imageIds]
    const occurrences = this.core.state.occurrences
    if (occurrences.length === 0) {
      this.deps.defaultSink(draft.trim(), imageIds, mode)
      return
    }
    const inputTriggers = this.deps.inputTriggers?.()
    const controller = new AbortController()
    void Promise.all(occurrences.map(async (o) => {
      if (inputTriggers === undefined) throw new Error(`no serializer for reference source "${o.source}"`)
      return { offset: o.offset, text: await inputTriggers.serializeReference(o.source, o.ref, controller.signal) }
    })).then(
      (parts) => {
        if (this.disposed) return
        // Splice model forms over their placeholders (offsets are draft-time;
        // parts arrive offset-sorted since the table is).
        let out = ''
        let cursor = 0
        for (const part of parts) {
          out += draft.slice(cursor, part.offset) + part.text
          cursor = part.offset + 1
        }
        out += draft.slice(cursor)
        this.deps.defaultSink(out.trim(), imageIds, mode)
      },
      (error: unknown) => {
        controller.abort()
        if (this.disposed) return
        const message = error instanceof Error ? error.message : String(error)
        this.notify('error', message)
      },
    )
  }

  /** Enter adjudication: poll the session controller; failure = notice + draft retained (never a silent downgrade). */
  private adjudicate(attempt: SubmitAttempt, draft: string): void {
    const inputTriggers = this.deps.inputTriggers?.()
    if (inputTriggers === undefined) {
      // No pipeline mounted: the '/' line is an ordinary message.
      this.run(this.core.dispatch({ type: 'adjudicated', attempt, outcome: undefined }))
      return
    }
    inputTriggers.adjudicate(draft.trim(), attempt.signal, {
      images: this.snapshot.imageIds.length,
    }).then(
      (outcome: PickOutcome) => {
        if (this.dead(attempt)) return
        this.run(this.core.dispatch({ type: 'adjudicated', attempt, outcome }))
      },
      (error: unknown) => {
        if (this.dead(attempt)) return
        const message = error instanceof Error ? error.message : String(error)
        this.run(this.core.dispatch({ type: 'adjudication-failed', attempt, message }))
      },
    )
  }

  /** The submit transaction: claim.submit against the session scope; ok maps from the outcome kind. */
  private beginSubmit(attempt: SubmitAttempt, claim: CommandClaim, args: string): void {
    const imageIds = claim.images === true ? [...this.imageIds] : []
    Promise.resolve()
      .then(async () => {
        const images = imageIds.length === 0 ? [] : await this.deps.commandImages.serialize(imageIds)
        if (this.dead(attempt)) return undefined
        return claim.submit(args, this.deps.actx, images)
      })
      .then(
        (outcome) => {
          if (outcome === undefined || this.dead(attempt)) return
          if (outcome.kind === 'success' && imageIds.length > 0) {
            const sent = new Set(imageIds)
            this.imageIds = this.imageIds.filter(id => !sent.has(id))
            this.deps.commandImages.release(imageIds)
          }
          this.run(this.core.dispatch({
            type: 'submit-settled', attempt, ok: outcome.kind === 'success', outcome,
          }))
        },
        (error: unknown) => {
          if (this.dead(attempt)) return
          const message = error instanceof Error ? error.message : String(error)
          this.run(this.core.dispatch({ type: 'submit-settled', attempt, ok: false, message }))
        },
      )
  }

  /** Late-settlement guard: superseded attempts and disposed facades drop silently. */
  private dead(attempt: SubmitAttempt): boolean {
    return this.disposed || attempt.signal.aborted
  }

  /**
   * Pair local echoes only when a newly observed official projection with the
   * same complete prompt content reaches the surface it owns. Pairing does
   * not retire the echo: the owning React surface acknowledges it after the
   * successor is present in that surface's committed input. One authoritative
   * occurrence pairs with at most one local occurrence, preserving FIFO
   * behavior for rapid identical sends.
   */
  private reconcileOutgoing(snapshot: ConversationSnapshot | undefined): void {
    if (snapshot === undefined) return
    const authoritative = authoritativeMessages(snapshot)
    const nextQueue = new Set(authoritative.filter(item => item.source === 'queue').map(item => item.id))
    const fresh = authoritative.filter(item => item.source === 'queue'
      ? !this.observedQueue.has(item.id)
      : item.seq > this.observedChatSeq)
    this.observedQueue = nextQueue
    for (const item of authoritative) {
      if (item.source === 'chat') this.observedChatSeq = Math.max(this.observedChatSeq, item.seq)
    }
    if (fresh.length === 0 || this.pendingOutgoing.length === 0) return
    const pending = [...this.pendingOutgoing]
    let changed = false
    for (const authoritative of fresh) {
      const index = pending.findIndex(candidate => (
        candidate.successor === undefined
        &&
        authoritative.accepts.includes(candidate.placement)
        && sameOutgoingContent(candidate, authoritative)
      ))
      if (index === -1) continue
      const candidate = pending[index]
      if (candidate === undefined) continue
      pending[index] = {
        ...candidate,
        successor: { source: authoritative.source, id: authoritative.id },
      }
      changed = true
    }
    if (changed) this.pendingOutgoing = pending
  }

  private compose(): InputState {
    const core = this.core.state
    return {
      ...core,
      imageIds: this.imageIds,
      queue: this.deps.authoritative?.getSnapshot().queue
        ?? this.deps.queue?.getSnapshot()
        ?? EMPTY_QUEUE,
      pendingOutgoing: this.pendingOutgoing,
    }
  }

  private publish(): void {
    const next = this.compose()
    this.state.set(next)
    if (next.draft !== this.lastDraft) {
      this.lastDraft = next.draft
      this.mirrorFn?.(next.draft)
    }
  }
}

interface AuthoritativeMessage {
  readonly id: string
  readonly source: 'queue' | 'chat'
  /** Durable event sequence; queue occurrences use -1. */
  readonly seq: number
  readonly text: string
  readonly imageNames: readonly string[]
  readonly accepts: readonly PendingOutgoingMessage['placement'][]
}

/** Extract plain text and ordered image names from official prompt content. */
function contentIdentity(content: readonly unknown[]): Pick<AuthoritativeMessage, 'text' | 'imageNames'> {
  let text = ''
  const imageNames: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null || !('type' in block)) continue
    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') text += block.text
    if (block.type === 'image' && 'attachment' in block && typeof block.attachment === 'object' && block.attachment !== null) {
      const attachment = block.attachment as { name?: unknown }
      imageNames.push(typeof attachment.name === 'string' ? attachment.name : '')
    }
  }
  return { text, imageNames }
}

/** Enumerate the official queue/log occurrences that can replace local echoes. */
function authoritativeMessages(snapshot: ConversationSnapshot): AuthoritativeMessage[] {
  const messages: AuthoritativeMessage[] = []
  for (const item of snapshot.queue) {
    if (item.placement === 'context') continue
    messages.push({
      id: `queue:${String(item.id)}:${item.placement}`,
      source: 'queue',
      seq: -1,
      ...contentIdentity(item.content),
      // The running/idle bit is only the browser's pre-admission view. A
      // queue send can race into a busy turn, and best-effort steer can fall
      // back to Queue, so any local delivery expectation may hand off here.
      accepts: item.placement === 'queued' ? ['turn', 'queue', 'steering'] : ['steering', 'queue'],
    })
  }
  for (const key of snapshot.chat.order) {
    const node = snapshot.chat.nodes.get(key)
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    const data = node.data
    if (typeof data !== 'object' || data === null
      || !('seq' in data) || typeof data.seq !== 'number'
      || !('content' in data) || !Array.isArray(data.content)) continue
    messages.push({
      id: `chat:${node.kind}:${String(data.seq)}`,
      source: 'chat',
      seq: data.seq,
      ...contentIdentity(data.content),
      // A queued message can be consumed before its queue frame reaches the
      // browser; its durable user row is still the authoritative handoff.
      accepts: node.kind === 'steering' ? ['steering', 'queue'] : ['turn', 'queue', 'steering'],
    })
  }
  return messages
}

function sameOutgoingContent(left: PendingOutgoingMessage, right: AuthoritativeMessage): boolean {
  return left.text === right.text
    && left.imageNames.length === right.imageNames.length
    && left.imageNames.every((name, index) => name === right.imageNames[index])
}
