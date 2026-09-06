/**
 * Frozen input-machine contract. Types
 * only. Three-tier visibility: business packages see InputState via the
 * InputZone currency; the scoped input events carry the mutation verbs; the
 * conversation wiring layer alone sees the full SessionInput. InputMachine
 * (machine.ts) is package-private and never exported.
 *
 * `InputState` / `InputActions` / `SessionInput` are the OFFICIAL 0.1.2
 * contracts (the session standard kit types them); the fork-only members
 * (paste matching, local outgoing echoes, echo acknowledgement) are merged
 * into the official interfaces below.
 */
import type {
  ArbitrateKey, ArbitrateOutcome, CommandClaim, ConsumeTokenRequest, PickOutcome,
  ReferenceInsert, SubmitOutcome, TokenSpan,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { QueueRow } from '../contract/queue.ts'
import type { InputSubmitMode } from '../contract/composer-submission.ts'

/** The official InputState contract (official Occurrence shape included). */
type OfficialInputState = import('@deepseek-ai/dsh-client-ui-conversation/client').InputState

/** Browser-runtime identity of one unsent image draft. */
export type DraftAttachmentId =
  import('@deepseek-ai/dsh-client-ui-conversation/client').DraftAttachmentId

/**
 * Browser-local presentation of one ordinary message between the submit
 * gesture and the first authoritative Host projection that represents it.
 * It is deliberately not durable session state: the Host queue/log remains
 * the sole business authority and replaces this row as soon as it arrives.
 */
export interface PendingOutgoingMessage {
  /** Session-input-local identity used only as a React key and settlement handle. */
  readonly id: number
  /** Exact serialized text sent to the ordinary prompt path. */
  readonly text: string
  /** Browser draft image names, used only to match the later durable content. */
  readonly imageNames: readonly string[]
  /** Where the eventual authoritative projection belongs. */
  readonly placement: 'turn' | 'queue' | 'steering'
  /**
   * Official projection that accepted this echo. The echo remains visible
   * until that projection's owning React surface confirms it has committed;
   * network admission alone is not a visual handoff.
   */
  readonly successor?: {
    readonly source: 'queue' | 'chat'
    readonly id: string
  }
}

/** One sync-matched paste component; start/end are relative to the pasted text. */
export interface PasteComponent extends EditSelection {
  readonly reference: ReferenceInsert
}

/**
 * Live paste-match attempt published while async matching may still upgrade
 * pasted tokens (the clipboard round-trip). Any non-paste transaction,
 * submit start, invalidate-paste, or release ends it; a paste-upgrade keeps
 * it current (later tokens re-CAS against the advanced draftRev).
 */
export interface PasteAttemptState {
  /** Machine-minted attempt identity (paste-upgrade must match it). */
  readonly attemptId: number
  /** Pasted range in the draft as of the paste transaction. */
  readonly insertedRange: EditSelection
  /** Caller-supplied projection generation echoed back (the controller drops cross-generation results). */
  readonly generation: number
}

/**
 * Fork-only members merged into the official published input state: the
 * live paste-match attempt and the ephemeral local outgoing echoes.
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface InputState {
    /** Live paste-match attempt (absent when no paste is matchable). */
    paste?: PasteAttemptState
    /**
     * Ephemeral local echoes awaiting an authoritative queue row or durable
     * user message. Absent on older/input-machine-only snapshots.
     */
    pendingOutgoing?: readonly PendingOutgoingMessage[]
  }
}

/** Published input state (the currency; per-session). */
export type InputState = OfficialInputState

/**
 * One reference chip occurrence, backing exactly one U+FFFC placeholder in
 * the draft (the official occurrence projection; `length` is the
 * clipboard-text span the chip represents).
 */
export type Occurrence = OfficialInputState['occurrences'][number]

/**
 * One independently addressable row projected from the transient queue snapshot.
 */
export type QueuedMessage = QueueRow

/**
 * The scoped-event application verbs: the hub's bail listeners call these,
 * and the boolean answer IS the event's bail value (true ⟺ the machine
 * accepted after phase and span/bare-token guards). Officially declared as
 * the base of `SessionInput` but not re-exported through the official client
 * index, so the face is recovered structurally.
 */
export type InputTarget =
  Pick<
    import('@deepseek-ai/dsh-client-ui-conversation/client').SessionInput,
    'beginCommand' | 'insertReference'
  >

/**
 * Fork-only member merged into the official per-session input facade: local
 * echo retirement stays under the fork composer's control.
 */
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface SessionInput {
    /** Retire local echoes only after their authoritative presentation committed. */
    acknowledgeOutgoing(ids: readonly number[]): void
  }
}

/** Per-session input facade owned by the conversation wiring layer. */
export type SessionInput =
  import('@deepseek-ai/dsh-client-ui-conversation/client').SessionInput

/** Session-addressed access to the per-session input facade. */
export type SessionInputResolver =
  import('@deepseek-ai/dsh-client-ui-conversation/client').SessionInputResolver

/**
 * The public input action face provided to every session-scope slot
 * component: two stable-identity void callbacks, mirroring the
 * useStore+actions convention. Command-style handles (track/arbitrate/space/
 * undo/paste/…) stay InputBar-private and never ride this face.
 */
export type InputActions =
  import('@deepseek-ai/dsh-client-ui-conversation/client').InputActions

/** One surfaced notice (command results, adjudication failures). seq keys re-render of repeats. */
export interface InputNotice {
  readonly level: 'info' | 'error'
  readonly text: string
  readonly seq: number
}

/**
 * The InputBar-exclusive keyboard/DOM command face: synchronous
 * returns and event-handler semantics that must not enter the public provide
 * channel. Handed to the composer-bar entry through its own inject —
 * package-internal, never across a plugin boundary. The session shell
 * satisfies it structurally.
 */
export interface ComposerKeyboard {
  /** Live machine state for event-handler reads (render reads go through useInput). */
  readonly snapshot: InputState
  /** Draft write with the DOM-observed edit shape (narrows occurrence math). */
  setDraft(text: string, editRange?: EditRange): void
  /** Submit with an explicit delivery mode resolved by the keyboard policy. */
  submit(mode: InputSubmitMode): void
  /**
   * Steer every still-pending queued message into the running turn (the
   * empty-draft accelerated-Enter gesture; the queue dock's per-row steer
   * button is the same operation applied to the whole queue).
   */
  steerQueue(): void
  undo(): void
  redo(): void
  /** Paste over the selection (sync components ride the same transaction). */
  pasteBegin(text: string, selection: EditSelection, components?: readonly PasteComponent[], generation?: number): void
  /** Caret/selection gestures the machine cannot observe end the paste attempt. */
  invalidatePaste(): void
  /** Feed a draft/caret change through trigger detection (guard derived from phase). */
  track(draft: string, caret: number): void
  /** Keyboard arbitration while the menu is open ('pass' when no pipeline). */
  arbitrate(key: ArbitrateKey, composing: boolean): ArbitrateOutcome
  /** Space adjudication; true = the input applied a claim — caller preventDefaults. */
  space(): boolean
  /** Dismiss the popupSelect shell (any interaction outside the box). */
  dismissPopup(): void
}

/** Guard union of the scoped consume-token event, checked by the machine. */
export type ConsumeTokenGuard = ConsumeTokenRequest['guard']

/** Half-open [start, end) range/selection in draft character coordinates. */
export interface EditSelection {
  readonly start: number
  readonly end: number
}

/**
 * One edit applied to the previous draft: [start, end) in the PREVIOUS
 * draft's coordinates was replaced by insertedLength characters. Supplied by
 * the wiring layer when the DOM event exposes the edit shape; absent, the
 * machine recovers it with a prefix/suffix common-scan diff.
 */
export interface EditRange extends EditSelection {
  readonly insertedLength: number
}

/**
 * InputMachine construction knobs. The machine never reads an ambient clock:
 * `now` is the only time source, injected by the shell (tests inject a
 * fake). The default clock is constant, i.e. consecutive single-char typing
 * always coalesces until a non-typing transaction intervenes.
 */
export interface InputMachineOptions {
  /** Single-char typing undo-merge window in ms (default 1000). */
  readonly mergeWindowMs?: number
  /** Monotonic clock for typing-merge decisions (default: constant 0). */
  readonly now?: () => number
}

/**
 * One in-flight submission attempt: the ONLY id concept in the submit plane.
 * Created on enter; carried by adjudicated/submit-settled events; stale
 * attempts are dropped (anti-backwash). release/session teardown aborts the
 * current attempt, keeping the promise bounded.
 */
export interface SubmitAttempt {
  readonly seq: number
  readonly signal: AbortSignal
  /** Draft at enter time; rollback restores it only while the live draft still equals it. */
  readonly draftSnapshot: string
  /** Default-message delivery intent retained while slash adjudication is pending. */
  readonly mode: InputSubmitMode
}

/**
 * InputMachine input events (the machine's single write path). Every draft
 * mutation is one transaction: draft edit, occurrence reconciliation, and
 * undo-log push are atomic inside dispatch(). Events carrying `at` stamp the
 * injected clock reading; only single-char typing coalescing reads it.
 */
export type InputEvent =
  /** Full next draft from the textarea; editRange narrows the occurrence math (absent → diff scan). */
  | { readonly type: 'draft-changed'; readonly draft: string; readonly editRange?: EditRange }
  | { readonly type: 'begin-command'; readonly claim: CommandClaim; readonly span: TokenSpan }
  /** Place one U+FFFC at the span and mint the occurrence (scoped insert-reference event payload). */
  | { readonly type: 'insert-ref'; readonly reference: ReferenceInsert; readonly span: TokenSpan }
  /** Delete a settled command token; success is observable as a draftRev advance. */
  | { readonly type: 'consume-token'; readonly guard: ConsumeTokenGuard }
  /** Owner-resolution result: exactly the listed occurrences are invalid (style bit; not a transaction). */
  | { readonly type: 'set-invalid'; readonly invalidIds: readonly number[] }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  /**
   * Paste text replacing the selection, one transaction. Hot-snapshot sync
   * matches ride in as components (chips minted inside the SAME transaction:
   * one undo returns to pre-paste); a PasteMatchAttempt opens for the async
   * remainder. Component ranges must be disjoint and inside the pasted text.
   */
  | { readonly type: 'paste-begin'; readonly text: string; readonly selection: EditSelection; readonly components?: readonly PasteComponent[]; readonly generation?: number }
  /** Async match landed: upgrade one pasted token to a chip as an INDEPENDENT transaction (undo #1 → text, undo #2 → pre-paste). */
  | { readonly type: 'paste-upgrade'; readonly attemptId: number; readonly span: TokenSpan; readonly reference: ReferenceInsert }
  /** Shell-observed attempt killers the machine cannot see itself (caret/selection ops, Slash interaction updates). */
  | { readonly type: 'invalidate-paste' }
  | { readonly type: 'enter'; readonly mode: InputSubmitMode }
  | { readonly type: 'adjudicated'; readonly attempt: SubmitAttempt; readonly outcome: PickOutcome }
  | { readonly type: 'adjudication-failed'; readonly attempt: SubmitAttempt; readonly message: string }
  | { readonly type: 'submit-settled'; readonly attempt: SubmitAttempt; readonly ok: boolean; readonly outcome?: SubmitOutcome; readonly message?: string }
  /**
   * An ordinary (default-sink) send was accepted: clear the draft as a COMMIT —
   * undo must not resurrect sent content (mirrors submit-settled's success arm).
   */
  | { readonly type: 'send-committed' }
  | { readonly type: 'release' }

/**
 * InputMachine output effects (executed by the SessionInput shell; the
 * machine stays pure). Draft/occurrence mutations carry no effect — the
 * shell publishes the state store after every dispatch.
 */
export type InputEffect =
  | { readonly type: 'adjudicate'; readonly attempt: SubmitAttempt; readonly draft: string }
  | { readonly type: 'begin-submit'; readonly attempt: SubmitAttempt; readonly claim: CommandClaim; readonly args: string }
  | { readonly type: 'default-sink'; readonly draft: string; readonly mode: InputSubmitMode }
  | { readonly type: 'notice'; readonly level: 'info' | 'error'; readonly text: string }
