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
  it.skipIf(!available)('executes a snapshot-fenced action sequence and settles its navigation postcondition', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html')
      response.end(request.url?.startsWith('/results')
        ? '<title>Results</title><main>Search complete</main>'
        : '<title>Search</title><form action="/results"><label for="query">Search docs</label><input id="query" name="q"><button>Go</button></form>')
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try {
      const address = server.address(); if (address === null || typeof address === 'string') throw new Error('HTTP test server did not expose a port.')
      const url = `http://127.0.0.1:${address.port}/`
      const provider = new OwnedPlaywrightProvider('chromium', new BrowserNetworkPolicy()); providers.push(provider)
      const signal = browserSignal(new AbortController().signal)
      const context = { automationSessionId: 'semantic-sequence', workspaceRoot: process.cwd(), signal }
      const tab = await provider.createTab(context, { url, requirements: { profile: 'isolated', visibility: 'background' } })
      const snapshot = await provider.execute(context, tab, { kind: 'inspect', action: 'snapshot' })
      if (snapshot.kind !== 'snapshot') throw new Error('Expected a semantic snapshot.')
      const input = snapshot.snapshot.nodes.find(node => node.role === 'textbox')
      expect(input?.stableLocators).toEqual([{ kind: 'role', role: 'textbox', name: 'Search docs', exact: true }])

      const result = await provider.execute(context, snapshot.tab, {
        kind: 'act', steps: [
          { action: 'fill', locator: { kind: 'node', snapshotId: snapshot.snapshot.snapshotId, nodeRef: input!.nodeRef }, value: 'codex cli' },
          { action: 'press', locator: { kind: 'node', snapshotId: snapshot.snapshot.snapshotId, nodeRef: input!.nodeRef }, value: 'Enter' },
        ], expected: 'navigation', expectedUrl: '**/results?q=codex+cli', urlMatch: 'glob',
      })

      expect(result.tab.url).toMatch(/\/results\?q=codex(?:\+|%20)cli$/)
      await expect(provider.execute(context, result.tab, { kind: 'wait', condition: 'url', value: '**/results*', urlMatch: 'glob', timeoutMs: 1_000 })).resolves.toMatchObject({ kind: 'state' })
    } finally { server.close(); await once(server, 'close') }
  }, 45_000)

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

  it.skipIf(!available)('adopts target-blank links into the current logical tab', async () => {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html')
      response.end(request.url === '/target' ? '<title>Target</title><main>Adopted popup</main>' : '<title>Source</title><a href="/target" target="_blank">Open target</a>')
    })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try {
      const address = server.address(); if (address === null || typeof address === 'string') throw new Error('HTTP test server did not expose a port.')
      const url = `http://127.0.0.1:${address.port}/`
      const provider = new OwnedPlaywrightProvider('chromium', new BrowserNetworkPolicy()); providers.push(provider)
      const context = { automationSessionId: 'popup-adoption', workspaceRoot: process.cwd(), signal: browserSignal(new AbortController().signal) }
      const tab = await provider.createTab(context, { url, requirements: { profile: 'isolated', visibility: 'background' } })
      const snapshot = await provider.execute(context, tab, { kind: 'inspect', action: 'snapshot' })
      if (snapshot.kind !== 'snapshot') throw new Error('Expected snapshot.')
      const link = snapshot.snapshot.nodes.find(node => node.name === 'Open target')
      expect(link).toMatchObject({ target: '_blank', opensNewTab: true, href: `${url}target` })

      const result = await provider.execute(context, snapshot.tab, { kind: 'act', action: 'click', locator: { kind: 'node', snapshotId: snapshot.snapshot.snapshotId, nodeRef: link!.nodeRef }, expected: 'navigation' })
      expect(result.tab.url).toBe(`${url}target`)
    } finally { server.close(); await once(server, 'close') }
  }, 45_000)

  it.skipIf(!available)('rejects ambiguous semantic locators before mutation', async () => {
    const server = createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end('<title>Ambiguous</title><button>Continue</button><button>Continue</button>') })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    try {
      const address = server.address(); if (address === null || typeof address === 'string') throw new Error('HTTP test server did not expose a port.')
      const provider = new OwnedPlaywrightProvider('chromium', new BrowserNetworkPolicy()); providers.push(provider)
      const context = { automationSessionId: 'ambiguous-locator', workspaceRoot: process.cwd(), signal: browserSignal(new AbortController().signal) }
      const tab = await provider.createTab(context, { url: `http://127.0.0.1:${address.port}/`, requirements: { profile: 'isolated', visibility: 'background' } })

      await expect(provider.execute(context, tab, { kind: 'inspect', action: 'elementInfo', locator: { kind: 'role', role: 'button', name: 'Continue', exact: true } })).rejects.toMatchObject({ code: 'AMBIGUOUS_LOCATOR' })
    } finally { server.close(); await once(server, 'close') }
  }, 45_000)
})
