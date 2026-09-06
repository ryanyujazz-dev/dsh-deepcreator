// Vendored from official deepseek-harness v0.1.1-rc.2
// (packages/client/runtime/src/client/sessions/pending.ts), re-typed for the
// 0.1.2 re-platform: the `approval/requested` / `question/requested` mux
// frames and the `ClientResponse`/`RpcReceipt` carrier types are gone, so the
// payload and receipt faces are declared structurally here. The long-term
// successor is the upstream `SessionPendingInteractionMap` /
// `registerPendingInteraction` model; this shim keeps the DeepCreator
// presentation packages compiling until that rewrite lands (migration Phase 4).

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

/** Kind-keyed payload map: the old requested frames' domain fields (envelope fields stripped). */
export interface PendingPayloads {
  approval: {
    /** Host-minted approval request id echoed in the answer. */
    approvalId: string
    /** The tool awaiting permission. */
    toolName: string
    /** Owning tool-call id when the approval is tied to one call. */
    callId?: string
    /** Optional human-readable reason the host requested confirmation. */
    reason?: string
  }
  question: {
    /** The structured questions the host asks the user. */
    questions: AskUserQuestionItem[]
  }
}

/** Pending-interaction discriminant (the keys of PendingPayloads). */
export type PendingKind = keyof PendingPayloads

/** Session-list summary of the user action currently blocking progress. */
export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Kind-discriminated union of concrete waits: narrowing on `kind` types `payload`. */
export type PendingInteraction = { [K in PendingKind]: PendingWait<K> }[PendingKind]

/** Result shell of one client response (the old `ClientResponse['result']`). */
export type PendingResponseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown }

/** Client-response envelope the carrier forwards to the host. */
export interface PendingResponseMessage {
  type: 'client-response'
  rpcId: string
  result: PendingResponseResult
}

/** Receipt face our consumers read back after a response (the old `RpcReceipt`). */
export interface PendingReceipt {
  accepted: boolean
  reason?: string
}

/** Key prefixes, one per kind (the key doubles as the Session pending-map key). */
const KEY_PREFIX: Record<PendingKind, string> = { approval: 'a', question: 'q' }

/**
 * One pending host-owned interaction wait: an immutable render face
 * (kind/key/sessionId/payload) plus the response carrier. respond() wraps the
 * result into a client-response envelope with the requested frame's rpcId
 * backfilled — no consumer ever sees the raw rpcId. Settlement is expressed
 * only by pending-list membership (the settled flag is a fail-loud guard, not
 * a render input).
 */
export class PendingWait<K extends PendingKind = PendingKind> {
  /** Interaction kind (union discriminant). */
  readonly kind: K
  /** Opaque render identity, `<prefix>:<rpcId>` — stable across baseline replay, usable as a React key. */
  readonly key: string
  /** Owning session. */
  readonly sessionId: SessionId
  /** The requested frame's domain fields, verbatim. */
  readonly payload: PendingPayloads[K]
  #settled = false
  readonly #rpcId: string
  readonly #respond: (message: PendingResponseMessage) => Promise<PendingReceipt>

  /**
   * Minted by the session layer on a requested frame (public construction is
   * the test-fixture path).
   * @param kind - interaction kind.
   * @param rpcId - the requested frame's stable envelope id (kept private; respond echoes it).
   * @param sessionId - owning session.
   * @param payload - the requested frame's domain fields.
   * @param respond - the client-response carrier.
   */
  constructor(
    kind: K, rpcId: string, sessionId: SessionId, payload: PendingPayloads[K],
    respond: (message: PendingResponseMessage) => Promise<PendingReceipt>,
  ) {
    this.kind = kind
    this.key = `${KEY_PREFIX[kind]}:${rpcId}`
    this.sessionId = sessionId
    this.payload = payload
    this.#rpcId = rpcId
    this.#respond = respond
  }

  /**
   * Send a result for this wait: wraps it into the client-response envelope
   * with the rpcId backfilled. Throws synchronously once settled.
   * @param result - the result shell (ok value / error envelope), domain-encoded by the caller.
   * @returns the carrier receipt.
   */
  respond(result: PendingResponseResult): Promise<PendingReceipt> {
    if (this.#settled) throw new Error(`pending wait ${this.key} is already settled`)
    return this.#respond({ type: 'client-response', rpcId: this.#rpcId, result })
  }

  /** Session-only settlement mark (the authoritative resolved frame arrived); respond() throws afterwards. */
  markSettled(): void {
    this.#settled = true
  }
}
