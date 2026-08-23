export const IMAGE_FAILURE_SOFT_LIMIT = 3
export const IMAGE_FAILURE_HARD_LIMIT = 5

export interface ImageGenerationAttemptScope {
  sessionId: string
  turn: number
}

function scopeKey(scope: ImageGenerationAttemptScope): string {
  return `${scope.sessionId}\0${scope.turn}`
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function hardLimitMessage(): string {
  return `create_image is blocked for the rest of this Agent turn after ${IMAGE_FAILURE_HARD_LIMIT} consecutive failures. Do not call create_image again in this turn. Report the latest failure to the user and wait for them to fix the VPN/system proxy or Provider configuration before trying again in a new turn.`
}

/** Per-turn retry circuit breaker for model-driven image generation calls. */
export class ImageGenerationRetryPolicy {
  private readonly failures = new Map<string, number>()

  assertCanAttempt(scope: ImageGenerationAttemptScope): void {
    if ((this.failures.get(scopeKey(scope)) ?? 0) >= IMAGE_FAILURE_HARD_LIMIT) throw new Error(hardLimitMessage())
  }

  recordSuccess(scope: ImageGenerationAttemptScope): void {
    this.failures.delete(scopeKey(scope))
  }

  recordFailure(scope: ImageGenerationAttemptScope, error: unknown): Error {
    const key = scopeKey(scope)
    const count = Math.min((this.failures.get(key) ?? 0) + 1, IMAGE_FAILURE_HARD_LIMIT)
    this.failures.set(key, count)
    const message = failureMessage(error)
    if (count < IMAGE_FAILURE_SOFT_LIMIT) return error instanceof Error ? error : new Error(message)
    if (count < IMAGE_FAILURE_HARD_LIMIT) {
      return new Error(`${message}\n\ncreate_image has failed ${count} consecutive times in this Agent turn. Stop automatic retries now. Report the failure above and ask the user to check the VPN/system proxy and Provider configuration before trying again.`, { cause: error })
    }
    return new Error(`${message}\n\nHard retry limit reached after ${IMAGE_FAILURE_HARD_LIMIT} consecutive create_image failures. Do not call create_image again in this Agent turn. Future calls in this turn will be blocked without contacting the Provider. Report the failure above and wait for the user to fix the VPN/system proxy or Provider configuration.`, { cause: error })
  }

  endTurn(scope: ImageGenerationAttemptScope): void {
    this.failures.delete(scopeKey(scope))
  }

  endSession(sessionId: string): void {
    for (const key of this.failures.keys()) {
      if (key.startsWith(`${sessionId}\0`)) this.failures.delete(key)
    }
  }

  dispose(): void {
    this.failures.clear()
  }
}
