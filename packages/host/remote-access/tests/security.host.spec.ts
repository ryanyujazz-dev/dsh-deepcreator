import { createServer } from 'node:http'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { authCookie, injectRemoteBootstrap, isAllowedLanHost, isRemoteApiAllowed, LanGateway, pairingPage, REMOTE_BOOTSTRAP_SCRIPT, remoteProxyHeaders, tokenHash } from '../src/gateway.ts'
import type { RemoteAccessDomain } from '../src/storage.ts'
import type { RemoteDeviceRecord } from '../src/types.ts'

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  return port
}

function memoryDomain(): RemoteAccessDomain {
  const devices = new Map<string, RemoteDeviceRecord>()
  const table = {
    get: (id: string) => devices.get(id),
    put: async (id: string, value: RemoteDeviceRecord) => { devices.set(id, value) },
    delete: async (id: string) => devices.delete(id),
    entries: () => devices.entries(),
    keys: () => devices.keys(),
  }
  return { table: () => table } as unknown as RemoteAccessDomain
}

describe('remote API default-deny policy', () => {
  it('allows the shared UI data plane and the retained Activity surface', () => {
    expect(isRemoteApiAllowed('/api/events.mux')).toBe(true)
    expect(isRemoteApiAllowed('/api/commands/list')).toBe(true)
    expect(isRemoteApiAllowed('/api/session.prompt')).toBe(true)
    expect(isRemoteApiAllowed('/api/subagent.history')).toBe(true)
    expect(isRemoteApiAllowed('/api/settings.describe')).toBe(true)
    expect(isRemoteApiAllowed('/api/artifacts/read')).toBe(true)
    expect(isRemoteApiAllowed('/api/review/diff')).toBe(true)
    expect(isRemoteApiAllowed('/api/jobs-admin/subagentOverview')).toBe(true)
  })

  it('denies native, administrative, destructive, and unknown endpoints', () => {
    expect(isRemoteApiAllowed('/api/settings/update')).toBe(false)
    expect(isRemoteApiAllowed('/api/commands/install')).toBe(false)
    expect(isRemoteApiAllowed('/api/terminal-workbench/create')).toBe(false)
    expect(isRemoteApiAllowed('/api/browser/newTab')).toBe(false)
    expect(isRemoteApiAllowed('/api/review/undoTurn')).toBe(false)
    expect(isRemoteApiAllowed('/api/session.delete')).toBe(false)
    expect(isRemoteApiAllowed('/api/remote-access/status')).toBe(false)
    expect(isRemoteApiAllowed('/api/not-listed')).toBe(false)
  })

  it('stores only a stable one-way token digest', () => {
    expect(tokenHash('secret')).toMatch(/^[a-f0-9]{64}$/)
    expect(tokenHash('secret')).toBe(tokenHash('secret'))
    expect(tokenHash('secret')).not.toBe(tokenHash('other'))
  })

  it('keeps the pairing ticket exclusively in the scanned URL fragment', () => {
    const html = pairingPage('deepcreator-test.local')
    expect(html).toContain('location.hash')
    expect(html).not.toContain('secret-ticket')
    expect(html).not.toContain('/pair#')
  })

  it('uses an HTTP-compatible host-only cookie with a 30-day rolling lifetime', () => {
    const cookie = authCookie('device.token')
    expect(cookie).toContain('deepcreator_remote=device.token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).not.toContain('Secure')
    expect(cookie).not.toContain('__Host-')
  })

  it('rejects DNS-rebinding and wrong-port Host authorities', () => {
    expect(isAllowedLanHost('deepcreator-test.local:43127', 'deepcreator-test.local', ['192.168.1.20'], 43127)).toBe(true)
    expect(isAllowedLanHost('192.168.1.20:43127', 'deepcreator-test.local', ['192.168.1.20'], 43127)).toBe(true)
    expect(isAllowedLanHost('attacker.example:43127', 'deepcreator-test.local', ['192.168.1.20'], 43127)).toBe(false)
    expect(isAllowedLanHost('192.168.1.20:8080', 'deepcreator-test.local', ['192.168.1.20'], 43127)).toBe(false)
  })

  it('omits an absent external Origin instead of forwarding an undefined header', () => {
    const navigation = remoteProxyHeaders({ host: '192.168.1.20:43127', 'content-length': '123' })
    expect(navigation['x-forwarded-host']).toBe('192.168.1.20:43127')
    expect(navigation['x-forwarded-origin']).toBeUndefined()
    expect(navigation['content-length']).toBeUndefined()
    expect(Object.values(navigation)).not.toContain(undefined)

    const rpc = remoteProxyHeaders({ host: '192.168.1.20:43127', origin: 'http://192.168.1.20:43127' })
    expect(rpc['x-forwarded-origin']).toBe('http://192.168.1.20:43127')
  })

  it('boots the official Client Runtime on an insecure LAN origin without weak randomness', () => {
    const html = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/app.js"></script></head></html>'
    const injected = injectRemoteBootstrap(html)
    expect(injected.indexOf('data-deepcreator-remote-bootstrap')).toBeGreaterThan(injected.indexOf('<head>'))
    expect(injected.indexOf('data-deepcreator-remote-bootstrap')).toBeLessThan(injected.indexOf('/app.js'))
    expect(injectRemoteBootstrap(injected)).toBe(injected)
    expect(REMOTE_BOOTSTRAP_SCRIPT).toContain('getRandomValues')
    expect(REMOTE_BOOTSTRAP_SCRIPT).not.toContain('Math.random')

    const context: { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array; randomUUID?: () => string } } = {
      crypto: { getRandomValues: bytes => { bytes.forEach((_, index) => { bytes[index] = index }); return bytes } },
    }
    runInNewContext(REMOTE_BOOTSTRAP_SCRIPT, context)
    expect(context.crypto.randomUUID?.()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })

  it('binds one QR ticket to one request and invalidates it when replaced', async () => {
    const port = await availablePort()
    const gateway = new LanGateway({
      port,
      innerPort: 9,
      hostId: 'test-host',
      domain: memoryDomain(),
      onDeviceSeen: () => {},
    })
    Object.assign(gateway, { addresses: ['127.0.0.1'] })
    await gateway.start()
    try {
      const firstTicket = await gateway.createTicket()
      const firstToken = new URL(firstTicket.setupUrl).hash.slice(1)
      const create = () => fetch(`http://127.0.0.1:${port}/deepcreator/remote/pair/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket: firstToken, deviceName: 'Test phone' }),
      })
      const first = await create()
      const firstBody = await first.json() as { requestId: string }
      const retry = await create()
      const retryBody = await retry.json() as { requestId: string }
      expect(first.status).toBe(200)
      expect(retry.status).toBe(200)
      expect(retryBody.requestId).toBe(firstBody.requestId)

      await gateway.createTicket()
      expect((await create()).status).toBe(410)
      expect((await fetch(`http://127.0.0.1:${port}/deepcreator/remote/pair/status`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: firstBody.requestId, ticket: firstToken }),
      })).status).toBe(410)
    } finally {
      await gateway.close()
    }
  })
})
