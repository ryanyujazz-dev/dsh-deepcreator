import { randomUUID } from 'node:crypto'
import type {
  OpenInDeepCreatorResult, PresentationClaimResult, PresentationClientDescriptor, PresentationFailure,
  PresentationMaterializeContext, PresentationPendingSnapshot, PresentationReceipt,
  PresentationRequest, PresentationResource, PresentationResourceResolver, PresentationSignalInput,
} from './types.ts'
import { presentationResourceKey } from './types.ts'
import { presentationSignal } from './types.ts'

type RegisteredResolver = PresentationResourceResolver<{ kind: string }>
type ReceiptWaiter = { resolve(receipt: PresentationReceipt): void; timer: NodeJS.Timeout }
type RevisionWaiter = { after: number; resolve(revision: number): void; timer: NodeJS.Timeout; abort(): void }

interface PendingEntry {
  request: PresentationRequest
  claimedBy?: string
  compatibleClientSeen: boolean
}

interface StableFailureEntry {
  failure: PresentationFailure
}

function canonicalInput(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalInput(item)}`).join(',')}}`
}

function unavailable(code: PresentationFailure['code'], stage: PresentationFailure['stage'], message: string, retryable = false): PresentationFailure {
  return { code, stage, retryable, message }
}

function compatible(request: PresentationRequest, client: PresentationClientDescriptor): boolean {
  const mode = request.resource.mode ?? 'none'
  return client.presenters.some(presenter => presenter.resourceKind === request.resource.kind && presenter.modes.includes(mode) && (mode !== 'live' || presenter.surfaceHost))
}

/** UI-agnostic resource resolver, client claim, receipt, and dismissal coordinator. */
export class PresentationRuntime {
  readonly #resolvers = new Map<string, RegisteredResolver>()
  readonly #pending = new Map<string, Map<string, PendingEntry>>()
  readonly #dismissals = new Set<string>()
  readonly #stableFailures = new Map<string, StableFailureEntry>()
  readonly #waiters = new Map<string, ReceiptWaiter>()
  readonly #revisions = new Map<string, number>()
  readonly #revisionWaiters = new Map<string, Set<RevisionWaiter>>()

  registerResolver<I extends { kind: string }>(resolver: PresentationResourceResolver<I>): () => void {
    if (this.#resolvers.has(resolver.kind)) throw new Error(`presentation resolver already registered: ${resolver.kind}`)
    const erased = resolver as unknown as RegisteredResolver
    this.#resolvers.set(resolver.kind, erased)
    return () => { if (this.#resolvers.get(resolver.kind) === erased) this.#resolvers.delete(resolver.kind) }
  }

  resolvers(): readonly RegisteredResolver[] { return [...this.#resolvers.values()] }

  parse(input: unknown): { kind: string } {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('Presentation input must be an object.')
    const kind = (input as Record<string, unknown>).kind
    if (typeof kind !== 'string') throw new Error('Presentation input.kind must be a string.')
    const resolver = this.#resolvers.get(kind)
    if (resolver === undefined) throw new Error(`No presentation resolver is registered for ${kind}.`)
    return resolver.parse(input)
  }

  async open(context: PresentationMaterializeContext, input: { kind: string }, timeoutMs = 10_000): Promise<OpenInDeepCreatorResult> {
    context = { ...context, signal: presentationSignal(context.signal) }
    const attemptKey = `${context.sessionId}\0${context.turn}\0${canonicalInput(input)}`
    const previousFailure = this.#stableFailures.get(attemptKey)
    if (previousFailure !== undefined) return {
      requestId: randomUUID(), status: 'unavailable',
      failure: { ...previousFailure.failure, retryable: false, message: `${previousFailure.failure.message} This stable presentation failure is suppressed for the rest of the current Agent turn.` },
    }
    const resolver = this.#resolvers.get(input.kind)
    if (resolver === undefined) return { requestId: randomUUID(), status: 'unavailable', failure: unavailable('RESOLVER_UNAVAILABLE', 'resolve', `No resolver is registered for ${input.kind}.`) }
    let resource: PresentationResource
    try { resource = await resolver.materialize(context, input as never) }
    catch (error) {
      return { requestId: randomUUID(), status: 'unavailable', failure: unavailable('MATERIALIZATION_FAILED', 'materialize', error instanceof Error ? error.message : String(error)) }
    }
    const key = presentationResourceKey(resource)
    const requestId = randomUUID()
    const resultBase = { requestId, resource: { kind: resource.kind, id: resource.id } }
    const dismissal = `${context.sessionId}\0${context.turn}\0${key}`
    if (this.#dismissals.has(dismissal)) {
      const result: OpenInDeepCreatorResult = { ...resultBase, status: 'suppressed' }
      await resolver.settle?.({ ...context, result }, input as never, resource)
      return result
    }
    const boundedTimeout = Math.min(Math.max(timeoutMs, 1), 30_000)
    const request: PresentationRequest = {
      requestId, sessionId: context.sessionId, turn: context.turn, resource,
      createdAt: Date.now(), deadlineAt: Date.now() + boundedTimeout,
    }
    let session = this.#pending.get(context.sessionId)
    if (session === undefined) { session = new Map(); this.#pending.set(context.sessionId, session) }
    const entry: PendingEntry = { request, compatibleClientSeen: false }
    session.set(requestId, entry)
    this.#bump(context.sessionId)
    let abortListener: (() => void) | undefined
    const receipt = await new Promise<PresentationReceipt>(resolve => {
      const timer = setTimeout(() => {
        this.#waiters.delete(requestId)
        session?.delete(requestId)
        this.#bump(context.sessionId)
        resolve({
          requestId, resourceKey: key, clientId: entry.claimedBy ?? '', status: 'unavailable',
          failure: entry.claimedBy === undefined
            ? unavailable(entry.compatibleClientSeen ? 'RECEIPT_TIMEOUT' : 'NO_CAPABLE_CLIENT', 'claim', entry.compatibleClientSeen ? 'A capable client did not claim the request before its deadline.' : 'No connected client can present this resource.', true)
            : unavailable('RECEIPT_TIMEOUT', 'acknowledge', 'The presenting client did not acknowledge before the request deadline.', true),
        })
      }, boundedTimeout)
      timer.unref?.()
      this.#waiters.set(requestId, { resolve, timer })
      abortListener = () => this.#finish(context.sessionId, {
        requestId, resourceKey: key, clientId: entry.claimedBy ?? '', status: 'unavailable',
        failure: unavailable('CLIENT_DISCONNECTED', 'acknowledge', 'Presentation was cancelled with the owning Agent turn.', true),
      }, false)
      if (context.signal.aborted) abortListener()
      let unsubscribe: () => void = () => undefined
      if (!context.signal.aborted) unsubscribe = context.signal.subscribe(abortListener)
      ;(entry as PendingEntry & { abortCleanup?: () => void }).abortCleanup = unsubscribe
    })
    ;(entry as PendingEntry & { abortCleanup?: () => void }).abortCleanup?.()
    const result: OpenInDeepCreatorResult = {
      ...resultBase, status: receipt.status,
      ...(receipt.presenterId === undefined ? {} : { presenterId: receipt.presenterId }),
      ...(receipt.failure === undefined ? {} : { failure: receipt.failure }),
    }
    if (result.status === 'unavailable' && result.failure !== undefined && !result.failure.retryable) {
      this.#stableFailures.set(attemptKey, { failure: result.failure })
    }
    try { await resolver.settle?.({ ...context, result }, input as never, resource) }
    catch { /* Settlement is cleanup/notification; it cannot rewrite an acknowledged outcome. */ }
    return result
  }

  pending(sessionId: string, client: PresentationClientDescriptor): PresentationPendingSnapshot {
    const requests: PresentationRequest[] = []
    for (const entry of this.#pending.get(sessionId)?.values() ?? []) {
      if (!compatible(entry.request, client)) continue
      entry.compatibleClientSeen = true
      if (entry.claimedBy === undefined || entry.claimedBy === client.clientId) requests.push(entry.request)
    }
    return { revision: this.#revisions.get(sessionId) ?? 0, requests }
  }

  claim(sessionId: string, requestId: string, client: PresentationClientDescriptor): PresentationClaimResult {
    const entry = this.#pending.get(sessionId)?.get(requestId)
    if (entry === undefined) return { claimed: false, failure: unavailable('RECEIPT_TIMEOUT', 'claim', 'The presentation request no longer exists.') }
    if (!compatible(entry.request, client)) return { claimed: false, failure: unavailable('NO_CAPABLE_CLIENT', 'claim', 'This client does not advertise the required resource kind and presentation mode.') }
    entry.compatibleClientSeen = true
    if (entry.claimedBy !== undefined && entry.claimedBy !== client.clientId) return { claimed: false }
    if (entry.claimedBy === undefined) { entry.claimedBy = client.clientId; this.#bump(sessionId) }
    return { claimed: true, request: entry.request }
  }

  waitForRevision(sessionId: string, after: number, signal: PresentationSignalInput, timeoutMs: number = 25_000): Promise<number> {
    const current = this.#revisions.get(sessionId) ?? 0
    if (current !== after || signal.aborted) return Promise.resolve(current)
    return new Promise(resolve => {
      let waiters = this.#revisionWaiters.get(sessionId)
      if (waiters === undefined) { waiters = new Set(); this.#revisionWaiters.set(sessionId, waiters) }
      const cancellation = presentationSignal(signal); let unsubscribe: () => void = () => undefined
      const finish = () => { clearTimeout(waiter.timer); unsubscribe(); waiters?.delete(waiter); if (waiters?.size === 0) this.#revisionWaiters.delete(sessionId); resolve(this.#revisions.get(sessionId) ?? 0) }
      const waiter: RevisionWaiter = { after, resolve: finish, timer: setTimeout(finish, Math.min(Math.max(timeoutMs, 1), 30_000)), abort: finish }
      waiter.timer.unref?.(); waiters.add(waiter); unsubscribe = cancellation.subscribe(waiter.abort)
    })
  }

  acknowledge(sessionId: string, receipt: PresentationReceipt): boolean {
    const entry = this.#pending.get(sessionId)?.get(receipt.requestId)
    if (entry === undefined || entry.claimedBy !== receipt.clientId || presentationResourceKey(entry.request.resource) !== receipt.resourceKey) return false
    return this.#finish(sessionId, receipt, true)
  }

  dismiss(sessionId: string, turn: number, key: string): void {
    this.#dismissals.add(`${sessionId}\0${turn}\0${key}`)
    for (const entry of this.#pending.get(sessionId)?.values() ?? []) {
      const request = entry.request
      if (request.turn !== turn || presentationResourceKey(request.resource) !== key) continue
      this.#finish(sessionId, { requestId: request.requestId, resourceKey: key, clientId: entry.claimedBy ?? '', status: 'suppressed' }, false)
    }
  }

  endTurn(sessionId: string, turn: number): void {
    for (const key of [...this.#dismissals]) if (key.startsWith(`${sessionId}\0${turn}\0`)) this.#dismissals.delete(key)
    for (const key of [...this.#stableFailures.keys()]) if (key.startsWith(`${sessionId}\0${turn}\0`)) this.#stableFailures.delete(key)
    for (const entry of this.#pending.get(sessionId)?.values() ?? []) {
      if (entry.request.turn !== turn) continue
      this.#finish(sessionId, {
        requestId: entry.request.requestId, resourceKey: presentationResourceKey(entry.request.resource), clientId: entry.claimedBy ?? '', status: 'unavailable',
        failure: unavailable('CLIENT_DISCONNECTED', 'acknowledge', 'The Agent turn ended before presentation completed.', true),
      }, false)
    }
  }

  dispose(): void {
    for (const [sessionId, requests] of this.#pending) for (const entry of requests.values()) this.#finish(sessionId, {
      requestId: entry.request.requestId, resourceKey: presentationResourceKey(entry.request.resource), clientId: entry.claimedBy ?? '', status: 'unavailable',
      failure: unavailable('CLIENT_DISCONNECTED', 'acknowledge', 'Presentation Runtime stopped.', true),
    }, false)
    this.#resolvers.clear(); this.#dismissals.clear(); this.#stableFailures.clear()
  }

  #finish(sessionId: string, receipt: PresentationReceipt, enforceClaim: boolean): boolean {
    const entry = this.#pending.get(sessionId)?.get(receipt.requestId)
    if (entry === undefined) return false
    if (enforceClaim && entry.claimedBy !== receipt.clientId) return false
    this.#pending.get(sessionId)?.delete(receipt.requestId)
    const waiter = this.#waiters.get(receipt.requestId)
    if (waiter !== undefined) { clearTimeout(waiter.timer); this.#waiters.delete(receipt.requestId); waiter.resolve(receipt) }
    this.#bump(sessionId)
    return true
  }

  #bump(sessionId: string): void {
    const revision = (this.#revisions.get(sessionId) ?? 0) + 1
    this.#revisions.set(sessionId, revision)
    for (const waiter of [...(this.#revisionWaiters.get(sessionId) ?? [])]) if (waiter.after !== revision) waiter.resolve(revision)
  }
}
