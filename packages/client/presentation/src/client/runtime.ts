import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PresentationClaimResult, PresentationClientDescriptor, PresentationFailure, PresentationMode,
  PresentationPendingSnapshot, PresentationReceipt, PresentationRemoteResult, PresentationRequest, PresentationResource,
} from '@ryanyujazz/dsh-presentation/types'

export interface PresentationRemoteClient {
  pending(sessionId: SessionId, client: PresentationClientDescriptor): Promise<RemoteResult<PresentationRemoteResult<PresentationPendingSnapshot>>>
  waitRevision?(sessionId: SessionId, afterRevision: number): Promise<RemoteResult<PresentationRemoteResult<{ revision: number }>>>
  claim(sessionId: SessionId, requestId: string, client: PresentationClientDescriptor): Promise<RemoteResult<PresentationRemoteResult<PresentationClaimResult>>>
  acknowledge(sessionId: SessionId, receipt: PresentationReceipt): Promise<RemoteResult<PresentationRemoteResult<{ acknowledged: boolean }>>>
  dismiss(sessionId: SessionId, turn: number, resourceKey: string): Promise<RemoteResult<PresentationRemoteResult<{ dismissed: true }>>>
}

export type PresenterOutcome = {
  status: 'presented' | 'suppressed' | 'unavailable'
  presenterId?: string
  failure?: PresentationFailure
}
export interface PresentationProvider {
  id: string
  priority: number
  resourceKinds: readonly string[]
  modes: readonly PresentationMode[]
  surfaceHost: boolean
  present(request: PresentationRequest, resource: PresentationResource): Promise<PresenterOutcome>
  dismiss?(resourceKey: string): void
}

export class PresentationProviderRegistry {
  readonly #providers = new Map<string, PresentationProvider>()
  constructor(private readonly changed: () => void = () => {}) {}
  register(provider: PresentationProvider): () => void {
    if (this.#providers.has(provider.id)) throw new Error(`presentation provider already registered: ${provider.id}`)
    this.#providers.set(provider.id, provider); this.changed()
    return () => { if (this.#providers.get(provider.id) === provider) { this.#providers.delete(provider.id); this.changed() } }
  }
  resolve(resource: PresentationResource): PresentationProvider | undefined {
    const mode = resource.mode ?? 'none'
    return [...this.#providers.values()]
      .filter(provider => provider.resourceKinds.includes(resource.kind) && provider.modes.includes(mode) && (mode !== 'live' || provider.surfaceHost))
      .sort((left, right) => right.priority - left.priority)[0]
  }
  descriptor(clientId: string): PresentationClientDescriptor {
    const providers = [...this.#providers.values()]
    return {
      clientId,
      presenters: providers.flatMap(provider => provider.resourceKinds.map(resourceKind => ({ resourceKind, modes: [...provider.modes], surfaceHost: provider.surfaceHost }))),
    }
  }
}

function failure(code: PresentationFailure['code'], stage: PresentationFailure['stage'], message: string, retryable = false): PresentationFailure {
  return { code, stage, message, retryable }
}

/** React-free client claim loop. A request is handled only after Host grants this client an atomic claim. */
export class PresentationClientRuntime {
  readonly clientId = globalThis.crypto?.randomUUID?.() ?? `client-${Date.now()}-${Math.random().toString(36).slice(2)}`
  readonly providers: PresentationProviderRegistry
  readonly #presented = new Map<string, { sessionId: SessionId; turn: number; resource: PresentationResource }>()
  readonly #presenting = new Set<string>()
  #watching = false
  #timer: ReturnType<typeof setInterval> | undefined
  #busy = false
  #revision = 0
  #sessionId: SessionId | undefined

  constructor(readonly remote: PresentationRemoteClient, private readonly currentSessionId: () => SessionId | undefined) {
    this.providers = new PresentationProviderRegistry(() => { if (this.#watching || this.#timer !== undefined) void this.poll() })
  }

  start(): () => void {
    if (this.#watching || this.#timer !== undefined) return () => {}
    if (this.remote.waitRevision === undefined) { this.#timer = setInterval(() => { void this.poll() }, 250); void this.poll() }
    else { this.#watching = true; void this.poll().then(() => this.#watch()) }
    return () => { this.#watching = false; if (this.#timer !== undefined) clearInterval(this.#timer); this.#timer = undefined }
  }

  async poll(): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    try {
      const sessionId = this.currentSessionId()
      if (sessionId === undefined) return
      const descriptor = this.providers.descriptor(this.clientId)
      const wire = await this.remote.pending(sessionId, descriptor)
      if (!wire.ok || !wire.value.ok) return
      this.#sessionId = sessionId; this.#revision = wire.value.value.revision
      for (const candidate of wire.value.value.requests) {
        if (this.#presenting.has(candidate.requestId)) continue
        const claimWire = await this.remote.claim(sessionId, candidate.requestId, descriptor)
        if (!claimWire.ok || !claimWire.value.ok || !claimWire.value.value.claimed || claimWire.value.value.request === undefined) continue
        const request = claimWire.value.value.request
        this.#presenting.add(request.requestId)
        try {
          const key = `${request.resource.kind}:${request.resource.id}`
          const provider = this.providers.resolve(request.resource)
          let outcome: PresenterOutcome
          if (provider === undefined) outcome = { status: 'unavailable', failure: failure('NO_PRESENTER', 'present', 'No registered presenter supports the claimed resource.') }
          else {
            try { outcome = await provider.present(request, request.resource) }
            catch (error) { outcome = { status: 'unavailable', presenterId: provider.id, failure: failure('PRESENTER_ERROR', 'present', error instanceof Error ? error.message : String(error), true) } }
          }
          if (outcome.status === 'presented') this.#presented.set(`${String(sessionId)}\0${key}`, { sessionId, turn: request.turn, resource: request.resource })
          const receipt: PresentationReceipt = { requestId: request.requestId, resourceKey: key, clientId: this.clientId, ...outcome }
          await this.remote.acknowledge(sessionId, receipt)
        } finally { this.#presenting.delete(request.requestId) }
      }
    } finally { this.#busy = false }
  }

  dismiss(resourceKind: string, resourceId?: string): void {
    const current = this.currentSessionId()
    if (current === undefined) return
    const prefix = `${String(current)}\0${resourceKind}:`
    const entries = resourceId === undefined
      ? [...this.#presented.entries()].filter(([identity]) => identity.startsWith(prefix))
      : [...this.#presented.entries()].filter(([identity]) => identity === `${prefix}${resourceId}`)
    for (const [identity, presented] of entries) {
      const key = identity.slice(String(current).length + 1)
      this.providers.resolve(presented.resource)?.dismiss?.(key)
      void this.remote.dismiss(presented.sessionId, presented.turn, key)
      this.#presented.delete(identity)
    }
  }

  dispose(): void { this.#watching = false; if (this.#timer !== undefined) clearInterval(this.#timer); this.#timer = undefined; this.#presented.clear() }

  async #watch(): Promise<void> {
    while (this.#watching && this.remote.waitRevision !== undefined) {
      const sessionId = this.currentSessionId()
      if (sessionId === undefined) { await this.#delay(250); continue }
      const after = this.#sessionId === sessionId ? this.#revision : -1
      try {
        const wire = await this.remote.waitRevision(sessionId, after)
        if (wire.ok && wire.value.ok) await this.poll()
        else await this.#delay(500)
      } catch { await this.#delay(500) }
    }
  }
  #delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }
}
