import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserNetworkPolicy, browserSignal } from '@ryanyujazz/dsh-browser'
import { OwnedPlaywrightProvider, resolvePlaywrightExecutable } from '../src/managed-provider.ts'
import { PlaywrightScriptIsolate } from '../src/script-isolate.ts'

const available = resolvePlaywrightExecutable('chromium').path !== undefined
const providers: OwnedPlaywrightProvider[] = []
const originalDshHome = process.env.DSH_HOME
let testDshHome: string
beforeEach(async () => { testDshHome = await mkdtemp(join(tmpdir(), 'dsh-playwright-integration-')); process.env.DSH_HOME = testDshHome })
afterEach(async () => { await Promise.all(providers.splice(0).map(provider => provider.dispose())); if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome; await rm(testDshHome, { recursive: true, force: true }) })

describe('Managed Playwright integration', () => {
  it.skipIf(!available)('runs real Page, Locator, request, and artifact APIs through the isolate', async () => {
    const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<title>DeepCreator test</title><button>Continue</button>') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try {
      const address = server.address(); if (address === null || typeof address === 'string') throw new Error('HTTP test server did not expose a port.')
      const url = `http://127.0.0.1:${address.port}/`
      const provider = new OwnedPlaywrightProvider('chromium', new BrowserNetworkPolicy()); providers.push(provider)
      const signal = browserSignal(new AbortController().signal)
      const context = { automationSessionId: 'integration', workspaceRoot: process.cwd(), signal }
      const tab = await provider.createTab(context, { url, requirements: { profile: 'isolated', visibility: 'background' } })
      const environment = provider.scriptEnvironment(tab.providerTabId)
      const result = await new PlaywrightScriptIsolate({ ...environment, engine: 'chromium', workspaceRoot: process.cwd() }, { mode: 'controlled', beforeCall: async () => undefined }).run(
        `async ({ playwright, page, artifacts }) => {
          const request = await playwright.request.newContext()
          const response = await request.get(${JSON.stringify(url)})
          const path = await artifacts.output('screenshot', 'png')
          await page.screenshot({ path })
          const value = { title: await page.title(), buttons: await page.getByRole('button').count(), status: await response.status() }
          await request.dispose()
          return value
        }`,
        30_000,
        signal,
      )
      expect(result.value).toEqual({ title: 'DeepCreator test', buttons: 1, status: 200 })
      expect(result.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'screenshot' })]))
    } finally { server.close(); await once(server, 'close') }
  }, 45_000)
})
