import type { BrowserErrorCode } from './types.ts'

export class BrowserRuntimeError extends Error {
  constructor(readonly code: BrowserErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message)
    this.name = 'BrowserRuntimeError'
  }
}

export function browserFailure(error: unknown): { ok: false; code: BrowserErrorCode; message: string } {
  if (error instanceof BrowserRuntimeError) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'BROWSER_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) }
}
