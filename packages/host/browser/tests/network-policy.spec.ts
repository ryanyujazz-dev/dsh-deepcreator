import { describe, expect, it } from 'vitest'
import { BrowserNetworkPolicy, isPrivateAddress } from '../src/network-policy.ts'

describe('BrowserNetworkPolicy', () => {
  it('rejects active and local-file schemes', async () => {
    const policy = new BrowserNetworkPolicy()
    await expect(policy.assertAllowed('file:///etc/passwd')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(policy.assertAllowed('javascript:alert(1)')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(policy.assertAllowed('data:text/html,hello')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
  })

  it('explains the loopback remedy when rejecting non-http schemes', async () => {
    const policy = new BrowserNetworkPolicy()
    const rejection = policy.assertAllowed('file:///E:/report/index.html')
    await expect(rejection).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(rejection).rejects.toThrow(/http:\/\/127\.0\.0\.1 loopback/)
    await expect(rejection).rejects.toMatchObject({ details: { suggestedNextStep: expect.stringContaining('127.0.0.1') } })
  })

  it('allows loopback development URLs but blocks private and metadata addresses', async () => {
    const policy = new BrowserNetworkPolicy()
    await expect(policy.assertAllowed('http://127.0.0.1:3000')).resolves.toMatchObject({ hostname: '127.0.0.1' })
    await expect(policy.assertAllowed('http://192.168.1.10')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(policy.assertAllowed('http://169.254.169.254/latest/meta-data')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
  })

  it('classifies IPv4 and IPv6 private ranges', () => {
    expect(isPrivateAddress('10.0.0.1')).toBe(true)
    expect(isPrivateAddress('fd00::1')).toBe(true)
    expect(isPrivateAddress('ff02::1')).toBe(true)
    expect(isPrivateAddress('::ffff:192.168.1.10')).toBe(true)
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
  })
})
