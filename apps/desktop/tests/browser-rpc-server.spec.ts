import { lstat, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocateBrowserRpcEndpoint, BrowserRpcServer } from '../src/browser-rpc-server.ts'

describe('Browser RPC endpoint allocation', () => {
  it.runIf(process.platform !== 'win32')('uses a short owner-only directory for Unix sockets', async () => {
    const allocation = await allocateBrowserRpcEndpoint('darwin')
    try {
      expect(allocation.endpoint.startsWith('/tmp/dcb-')).toBe(true)
      expect(Buffer.byteLength(allocation.endpoint)).toBeLessThan(104)
      expect(allocation.endpoint).toBe(`${dirname(allocation.endpoint)}/rpc.sock`)
      expect((await lstat(dirname(allocation.endpoint))).mode & 0o777).toBe(0o700)
    } finally {
      await rm(allocation.directory!, { recursive: true, force: true })
    }
  })

  it('keeps Windows on an authenticated named pipe', async () => {
    const allocation = await allocateBrowserRpcEndpoint('win32')
    expect(allocation.endpoint.startsWith('\\\\.\\pipe\\deepcreator-browser-')).toBe(true)
    expect(allocation.directory).toBeUndefined()
  })

  it.runIf(process.platform !== 'win32')('binds the short socket and removes its private directory', async () => {
    const server = new BrowserRpcServer()
    await server.start()
    const endpoint = server.endpoint!
    const directory = dirname(endpoint)
    try {
      expect((await lstat(endpoint)).isSocket()).toBe(true)
      expect((await lstat(endpoint)).mode & 0o777).toBe(0o600)
      expect(server.hostEnv().DEEP_CREATOR_BROWSER_RPC_ENDPOINT).toBe(endpoint)
    } finally {
      await server.stop()
    }
    await expect(lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
