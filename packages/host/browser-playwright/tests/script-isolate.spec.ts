import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserRuntimeError } from '@ryanyujazz/dsh-browser'
import { applyApiRequestProxy, PlaywrightScriptIsolate } from '../src/script-isolate.ts'

const signal = new AbortController().signal
const policy = { mode: 'controlled' as const, beforeCall: async () => undefined }
const originalDshHome = process.env.DSH_HOME
let testDshHome: string
beforeEach(async () => { testDshHome = await mkdtemp(join(tmpdir(), 'dsh-playwright-isolate-')); process.env.DSH_HOME = testDshHome })
afterEach(async () => { if (originalDshHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = originalDshHome; await rm(testDshHome, { recursive: true, force: true }) })

describe('PlaywrightScriptIsolate', () => {
  it('creates and tears down 100 isolates without retaining pending jobs', async () => {
    for (let index = 0; index < 100; index++) {
      const result = await new PlaywrightScriptIsolate({ page: { async title() { return `page-${index}` } }, workspaceRoot: process.cwd() }, policy).run(
        'async ({ page }) => await page.title()', 5_000, signal,
      )
      expect(result.value).toBe(`page-${index}`)
    }
  }, 30_000)

  it('executes TypeScript against async host handles and returns JSON', async () => {
    const page = { async title() { return 'DeepCreator' }, async answer(value: number) { return value + 1 } }
    const result = await new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run(
      'async ({ page }): Promise<object> => ({ title: await page.title(), answer: await page.answer(41), process: typeof process, require: typeof require })',
      5_000,
      signal,
    )
    expect(result.value).toEqual({ title: 'DeepCreator', answer: 42, process: 'undefined', require: 'undefined' })
  })

  it('rejects final values containing an un-awaited Playwright proxy with actionable guidance', async () => {
    const page = { url() { return 'https://example.test/' } }
    await expect(new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run(
      'async ({ page }) => ({ url: page.url() })', 5_000, signal,
    )).rejects.toMatchObject({ code: 'PLAYWRIGHT_RUNTIME_ERROR', message: expect.stringContaining('Await every Playwright method') })
  })

  it('applies the Desktop proxy to standalone APIRequestContext creation', async () => {
    const args: unknown[] = [{ ignoreHTTPSErrors: true, proxy: { server: 'http://ignored.test' } }]
    applyApiRequestProxy(args, { server: 'http://proxy.test:3128', bypass: 'localhost' })
    expect(args[0]).toEqual({ ignoreHTTPSErrors: true, proxy: { server: 'http://proxy.test:3128', bypass: 'localhost' } })
  })

  it.each([500_000, 3_000_000])('handles a %i-character page body when the script extracts a bounded result', async size => {
    const page = { async content() { return 'x'.repeat(size) } }
    const result = await new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run(
      'async ({ page }) => { const html = await page.content(); return { length: html.length, sample: html.slice(0, 32) } }', 10_000, signal,
    )
    expect(result.value).toEqual({ length: size, sample: 'x'.repeat(32) })
  }, 20_000)

  it('blocks opaque methods in controlled mode before the host side effect', async () => {
    let called = false
    const page = { async evaluate() { called = true; return 1 } }
    await expect(new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run('async ({ page }) => page.evaluate(() => 1)', 5_000, signal)).rejects.toMatchObject<Partial<BrowserRuntimeError>>({ code: 'PLAYWRIGHT_POLICY_BLOCKED' })
    expect(called).toBe(false)
  })

  it('blocks constructor, prototype, private-member, and Function-call escape paths', async () => {
    const page = { async title() { return 'safe' }, _connection: { process } }
    await expect(new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run("async ({ page }) => page.constructor.constructor.call(null, 'return process')", 5_000, signal)).rejects.toMatchObject({ code: 'PLAYWRIGHT_RUNTIME_ERROR' })
    await expect(new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run('async ({ page }) => page._connection.process.env', 5_000, signal)).rejects.toMatchObject({ code: 'PLAYWRIGHT_RUNTIME_ERROR' })
  })

  it('rejects raw path arguments', async () => {
    const page = { async screenshot(_options: unknown) { return Buffer.from('bad') } }
    await expect(new PlaywrightScriptIsolate({ page, workspaceRoot: process.cwd() }, policy).run("async ({ page }) => page.screenshot({ path: '/tmp/out.png' })", 5_000, signal)).rejects.toMatchObject<Partial<BrowserRuntimeError>>({ code: 'PLAYWRIGHT_POLICY_BLOCKED' })
  })

  it('redacts cookie, storage, header, and request-body values at the model boundary', async () => {
    const request = {
      async headersArray() { return [{ name: 'authorization', value: 'Bearer secret' }, { name: 'accept', value: 'text/html' }] },
      async postData() { return 'password=secret' },
    }
    const context = {
      request,
      async cookies() { return [{ name: 'session', value: 'secret-cookie', domain: 'example.test', path: '/' }] },
      async storageState() { return { cookies: [{ name: 'auth', value: 'secret-state' }], origins: [{ origin: 'https://example.test', localStorage: [{ name: 'token', value: 'secret-token' }] }] } },
    }
    const result = await new PlaywrightScriptIsolate({ context, workspaceRoot: process.cwd() }, policy).run(
      'async ({ context }) => ({ cookies: await context.cookies(), storage: await context.storageState(), headers: await context.request.headersArray(), body: await context.request.postData() })',
      5_000,
      signal,
    )
    expect(JSON.stringify(result.value)).not.toContain('secret')
    expect(result.value).toMatchObject({ cookies: [{ value: '[REDACTED]' }], headers: [{ value: '[REDACTED]' }, { value: 'text/html' }], body: '[REDACTED]' })
  })

  it('brokers nested video directories, blocks raw paths, and carries byte arguments', async () => {
    let receivedBytes: Buffer | undefined
    const browser = { async newContext(_options: unknown) { return { ok: true } }, async launchPersistentContext() { return { unsafe: true } } }
    const route = { async fulfill(options: { body: Buffer }) { receivedBytes = options.body; return true } }
    await expect(new PlaywrightScriptIsolate({ browser, workspaceRoot: process.cwd() }, policy).run("async ({ browser }) => browser.newContext({ recordVideo: { dir: '/tmp/raw' } })", 5_000, signal)).rejects.toMatchObject({ code: 'PLAYWRIGHT_POLICY_BLOCKED' })
    await expect(new PlaywrightScriptIsolate({ browser, workspaceRoot: process.cwd() }, policy).run("async ({ browser }) => browser.launchPersistentContext('/tmp/profile')", 5_000, signal)).rejects.toMatchObject({ code: 'PLAYWRIGHT_POLICY_BLOCKED' })
    const result = await new PlaywrightScriptIsolate({ browser, page: route, workspaceRoot: process.cwd() }, policy).run(
      "async ({ browser, page, artifacts }) => { const dir=await artifacts.directory('video'); await browser.newContext({recordVideo:{dir}}); await page.fulfill({body:new Uint8Array([1,2,3])}); return true }",
      5_000,
      signal,
    )
    expect(result.value).toBe(true)
    expect(receivedBytes).toEqual(Buffer.from([1, 2, 3]))
    expect(result.artifacts).toEqual([expect.objectContaining({ kind: 'video' })])
  })
})
