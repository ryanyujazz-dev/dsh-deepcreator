import { describe, expect, it } from 'vitest'
import { classifyHeadlessAccess } from '../src/managed-provider.ts'

describe('Managed Playwright access classification', () => {
  it('reserves authentication for 401 and explicit login surfaces', () => {
    expect(classifyHeadlessAccess({ status: 401, finalUrl: 'https://example.test/private', challenge: false, authField: false, headed: false })).toMatchObject({ code: 'AUTH_REQUIRED', details: expect.objectContaining({ httpStatus: 401 }) })
    expect(classifyHeadlessAccess({ status: 200, finalUrl: 'https://example.test/login', challenge: false, authField: true, headed: false })).toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('distinguishes challenges and ordinary 403 denial', () => {
    expect(classifyHeadlessAccess({ status: 403, finalUrl: 'https://example.test/cdn-cgi/challenge', challenge: true, authField: false, headed: false })).toMatchObject({ code: 'HEADLESS_BLOCKED' })
    expect(classifyHeadlessAccess({ status: 403, finalUrl: 'https://example.test/forbidden', challenge: false, authField: false, headed: false })).toMatchObject({ code: 'ACCESS_DENIED', details: expect.objectContaining({ httpStatus: 403 }) })
  })

  it('does not classify headed pages as headless failures', () => {
    expect(classifyHeadlessAccess({ status: 403, finalUrl: 'https://example.test/challenge', challenge: true, authField: false, headed: true })).toBeUndefined()
  })
})
