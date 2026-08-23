import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { browserSignal } from '@ryanyujazz/dsh-browser'
import { ChromeBridgeServer, chromeRendezvousPath } from '../src/bridge.ts'
import { CHROME_EXTENSION_ID } from '../src/install.ts'
import { ChromeExtensionProvider } from '../src/provider.ts'

const originalDshHome = process.env.DSH_HOME
const roots: string[] = []

afterEach(async () => {
  if (originalDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalDshHome
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('System Chrome Provider', () => {
  it('is discoverable but not installable outside Desktop', () => {
    const provider = new ChromeExtensionProvider(new ChromeBridgeServer(), false)
    expect(provider.descriptor()).toMatchObject({ browserId: 'chrome', availability: 'unavailable', diagnostic: 'System Chrome control is available only in DeepCreator Desktop.' })
    expect(provider.descriptor().capabilities).not.toContain('management.install')
  })

  it('ships a fixed-ID MV3 extension with explicit tab sharing and no remote-debugging port', async () => {
    expect(CHROME_EXTENSION_ID).toMatch(/^[a-p]{32}$/)
    const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8')) as { manifest_version: number; key?: string; permissions: string[] }
    const worker = await readFile(new URL('../extension/service-worker.js', import.meta.url), 'utf8')
    expect(manifest).toMatchObject({ manifest_version: 3 })
    expect(manifest.key?.length).toBeGreaterThan(100)
    expect(manifest.permissions).toEqual(expect.arrayContaining(['debugger', 'tabs', 'tabGroups']))
    expect(worker).toContain('chrome.action.onClicked')
    expect(worker).toContain("const AGENT_GROUP_TITLE = 'DeepCreator Agent'")
    expect(worker).not.toContain('remote-debugging-port')
  })

  it('accepts only the rendezvous token and carries command responses over the private bridge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-chrome-test-')); roots.push(root); process.env.DSH_HOME = root
    const bridge = new ChromeBridgeServer(); await bridge.start()
    try {
      const rendezvous = JSON.parse(await readFile(chromeRendezvousPath(), 'utf8')) as { endpoint: string; token: string }
      const rejected = connect(rendezvous.endpoint); await once(rejected, 'connect'); rejected.write(`${JSON.stringify({ kind: 'hello', token: 'wrong' })}\n`); await once(rejected, 'close')
      expect(bridge.connected).toBe(false)

      const socket = connect(rendezvous.endpoint); await once(socket, 'connect'); socket.setEncoding('utf8')
      socket.write(`${JSON.stringify({ kind: 'hello', token: rendezvous.token })}\n`)
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(bridge.connected).toBe(true)

      const received = once(socket, 'data') as Promise<[string]>
      const result = bridge.call<{ echoed: boolean }>('ping', { value: 1 }, browserSignal(new AbortController().signal))
      const [line] = await received
      const request = JSON.parse(line.trim()) as { id: string; method: string }
      expect(request.method).toBe('ping')
      socket.write(`${JSON.stringify({ id: request.id, ok: true, result: { echoed: true } })}\n`)
      await expect(result).resolves.toEqual({ echoed: true })
      socket.destroy()
    } finally { await bridge.dispose() }
  })
})
