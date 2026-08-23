import { describe, expect, it } from 'vitest'
import { IMAGE_FAILURE_HARD_LIMIT, ImageGenerationRetryPolicy } from '../src/retry-policy.ts'

const firstTurn = { sessionId: 'session-1', turn: 1 }

describe('image generation retry policy', () => {
  it('adds stop-retrying guidance on the third consecutive failure', () => {
    const policy = new ImageGenerationRetryPolicy()
    expect(policy.recordFailure(firstTurn, new Error('offline')).message).toBe('offline')
    expect(policy.recordFailure(firstTurn, new Error('offline')).message).toBe('offline')
    expect(policy.recordFailure(firstTurn, new Error('offline')).message).toContain('Stop automatic retries now')
  })

  it('allows five provider attempts and hard-blocks later calls in the same turn', () => {
    const policy = new ImageGenerationRetryPolicy()
    let fifth = new Error('not attempted')
    for (let attempt = 1; attempt <= IMAGE_FAILURE_HARD_LIMIT; attempt += 1) {
      expect(() => policy.assertCanAttempt(firstTurn)).not.toThrow()
      fifth = policy.recordFailure(firstTurn, new Error('offline'))
    }
    expect(fifth.message).toContain('Hard retry limit reached after 5 consecutive')
    expect(() => policy.assertCanAttempt(firstTurn)).toThrow('blocked for the rest of this Agent turn')
  })

  it('resets after success and isolates later user turns', () => {
    const policy = new ImageGenerationRetryPolicy()
    for (let attempt = 0; attempt < IMAGE_FAILURE_HARD_LIMIT; attempt += 1) policy.recordFailure(firstTurn, new Error('offline'))
    policy.recordSuccess(firstTurn)
    expect(() => policy.assertCanAttempt(firstTurn)).not.toThrow()

    for (let attempt = 0; attempt < IMAGE_FAILURE_HARD_LIMIT; attempt += 1) policy.recordFailure(firstTurn, new Error('offline'))
    expect(() => policy.assertCanAttempt({ sessionId: 'session-1', turn: 2 })).not.toThrow()
    policy.endTurn(firstTurn)
    expect(() => policy.assertCanAttempt(firstTurn)).not.toThrow()
  })
})
