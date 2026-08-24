import { describe, expect, it } from 'vitest'
import { resolvePlaywrightProxy } from '../src/managed-provider.ts'

describe('Managed Playwright proxy configuration', () => {
  it('prefers HTTPS proxy, separates credentials, and forwards NO_PROXY', () => {
    expect(resolvePlaywrightProxy({
      HTTP_PROXY: 'http://fallback.test:8080',
      HTTPS_PROXY: 'http://user:pass@proxy.test:3128',
      NO_PROXY: 'localhost,127.0.0.1,.internal.test',
    })).toEqual({
      server: 'http://proxy.test:3128', username: 'user', password: 'pass', bypass: 'localhost,127.0.0.1,::1,.internal.test',
    })
  })

  it('supports lowercase proxy variables and no-proxy mode', () => {
    expect(resolvePlaywrightProxy({ http_proxy: 'proxy.test:8080', no_proxy: '*' })).toEqual({ server: 'http://proxy.test:8080', bypass: '*' })
    expect(resolvePlaywrightProxy({})).toBeUndefined()
  })
})
