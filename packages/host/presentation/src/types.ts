import type { ObjectValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export type PresentationMode = 'live' | 'snapshot' | 'none'
export type PresentationStatus = 'presented' | 'suppressed' | 'unavailable'
export type PresentationFailureCode =
  | 'NO_CAPABLE_CLIENT' | 'NO_PRESENTER' | 'PANEL_UNAVAILABLE'
  | 'PANEL_RENDER_TIMEOUT' | 'SURFACE_BRIDGE_UNAVAILABLE'
  | 'SURFACE_MOUNT_REJECTED' | 'SURFACE_MOUNT_TIMEOUT' | 'SURFACE_DESTROYED'
  | 'PRESENTER_ERROR' | 'RECEIPT_TIMEOUT' | 'CLIENT_DISCONNECTED'
  | 'RESOLVER_UNAVAILABLE' | 'MATERIALIZATION_FAILED'
export type PresentationFailureStage = 'resolve' | 'materialize' | 'claim' | 'present' | 'mount' | 'acknowledge'

/** Resource packages augment this map; Presentation Core has no domain-resource dependencies. */
export interface PresentationInputMap {}
export type PresentationInput = {
  [K in keyof PresentationInputMap]: { kind: K } & PresentationInputMap[K]
}[keyof PresentationInputMap]

export interface PresentationFailure {
  code: PresentationFailureCode
  stage: PresentationFailureStage
  retryable: boolean
  message: string
}
export interface PresentationResource { kind: string; id: string; mode?: PresentationMode; metadata?: Record<string, string> }
export interface PresentationRequest {
  requestId: string
  sessionId: string
  turn: number
  resource: PresentationResource
  createdAt: number
  deadlineAt: number
}
export interface PresentationClientDescriptor {
  clientId: string
  presenters: Array<{ resourceKind: string; modes: PresentationMode[]; surfaceHost: boolean }>
}
export interface PresentationReceipt {
  requestId: string
  resourceKey: string
  clientId: string
  status: PresentationStatus
  presenterId?: string
  failure?: PresentationFailure
}
export interface PresentationPendingSnapshot { revision: number; requests: PresentationRequest[] }
export interface PresentationClaimResult {
  claimed: boolean
  request?: PresentationRequest
  failure?: PresentationFailure
}
export interface OpenInDeepCreatorResult {
  requestId: string
  resource?: { kind: string; id: string }
  status: PresentationStatus
  presenterId?: string
  failure?: PresentationFailure
}
export interface PresentationSignalInput { readonly aborted: boolean }
export interface PresentationSignal extends PresentationSignalInput { subscribe(listener: () => void): () => void }
export function presentationSignal(input: PresentationSignalInput): PresentationSignal {
  const candidate = input as PresentationSignalInput & { subscribe?: (listener: () => void) => () => void; addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void; removeEventListener?: (type: string, listener: () => void) => void }
  return { get aborted() { return input.aborted }, subscribe(listener) { if (input.aborted) { listener(); return () => undefined }; if (candidate.subscribe !== undefined) return candidate.subscribe(listener); if (candidate.addEventListener === undefined) return () => undefined; candidate.addEventListener('abort', listener, { once: true }); return () => candidate.removeEventListener?.('abort', listener) } }
}
export interface PresentationMaterializeContext { sessionId: string; turn: number; workspaceRoot: string; signal: PresentationSignal }
export interface PresentationSettleContext extends PresentationMaterializeContext { result: OpenInDeepCreatorResult }
export interface PresentationResourceResolver<I extends { kind: string } = { kind: string }> {
  kind: I['kind']
  description: string
  inputSchema: ObjectValueSchemaSpec
  parse(input: unknown): I
  materialize(context: PresentationMaterializeContext, input: I): Promise<PresentationResource>
  settle?(context: PresentationSettleContext, input: I, resource: PresentationResource): Promise<void> | void
}
export type PresentationRemoteResult<T> = { ok: true; value: T } | { ok: false; code: 'PRESENTATION_UNAVAILABLE'; message: string }

export function presentationResourceKey(resource: PresentationResource): string { return `${resource.kind}:${resource.id}` }
