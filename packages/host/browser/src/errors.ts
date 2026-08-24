import type { BrowserErrorCode, BrowserErrorDetails } from './types.ts'

export class BrowserRuntimeError extends Error {
  constructor(readonly code: BrowserErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'BrowserRuntimeError'
  }
}

function remoteDetails(value: Record<string, unknown> | undefined): BrowserErrorDetails | undefined {
  if (value === undefined) return undefined
  const details: BrowserErrorDetails = {}
  if (typeof value.httpStatus === 'number') details.httpStatus = value.httpStatus
  if (typeof value.finalUrl === 'string') details.finalUrl = value.finalUrl
  if (typeof value.lifecycleReason === 'string' && ['provider-close', 'turn-cleanup', 'client-close', 'presentation-rollback', 'owner-restarted', 'runtime-dispose'].includes(value.lifecycleReason)) details.lifecycleReason = value.lifecycleReason as NonNullable<BrowserErrorDetails['lifecycleReason']>
  if (typeof value.suggestedNextStep === 'string') details.suggestedNextStep = value.suggestedNextStep
  if (typeof value.receivedBytes === 'number') details.receivedBytes = value.receivedBytes
  if (typeof value.timeoutPhase === 'string' && ['connect', 'first-byte', 'download', 'decompress', 'total'].includes(value.timeoutPhase)) details.timeoutPhase = value.timeoutPhase as NonNullable<BrowserErrorDetails['timeoutPhase']>
  if (typeof value.documentId === 'string') details.documentId = value.documentId
  if (typeof value.tabId === 'string') details.tabId = value.tabId
  if (typeof value.providerTabId === 'string') details.providerTabId = value.providerTabId
  return Object.keys(details).length === 0 ? undefined : details
}

export function browserFailure(error: unknown): { ok: false; code: BrowserErrorCode; message: string; details?: BrowserErrorDetails } {
  if (error instanceof BrowserRuntimeError) {
    const details = remoteDetails(error.details)
    return { ok: false, code: error.code, message: error.message, ...(details === undefined ? {} : { details }) }
  }
  return { ok: false, code: 'BROWSER_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) }
}
