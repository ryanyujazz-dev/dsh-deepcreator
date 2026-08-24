import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Download, type Frame, type Locator, type Page,
} from 'playwright-core'
import {
  BrowserNetworkPolicy, BrowserRuntimeError, DOCUMENT_EXTRACTION_SCRIPT, INTERACTIVE_SNAPSHOT_SCRIPT, browserActionSteps, matchBrowserUrl, resolveWorkspaceUpload,
  type BrowserCommand, type BrowserCommandResult, type BrowserDescriptor, type BrowserFamily, type BrowserLocator,
  type BrowserNodeRef, type BrowserProvider, type BrowserProviderContext,
  type BrowserDocumentScriptResult, type BrowserSnapshotScriptRow, type BrowserTabRequest, type PresentationBinding, type ProviderTab,
} from '@ryanyujazz/dsh-browser'

export type PlaywrightEngine = 'chromium' | 'firefox' | 'webkit'
interface RefEntry { snapshotId: string; selectors: Map<string, string> }
interface PageEntry { page: Page; context: BrowserContext; browser?: Browser; ownsContext: boolean; presentation: PresentationBinding }

function armMainFrameNavigation(page: Page, timeoutMs: number): { promise: Promise<Error | undefined>; dispose(): void } {
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolve!: (outcome: Error | undefined) => void
  const onFrameNavigated = (frame: Frame): void => { if (frame === page.mainFrame()) finish(undefined) }
  const cleanup = (): void => { page.off('framenavigated', onFrameNavigated); if (timer !== undefined) clearTimeout(timer) }
  const finish = (outcome: Error | undefined): void => { if (settled) return; settled = true; cleanup(); resolve(outcome) }
  const promise = new Promise<Error | undefined>(done => { resolve = done })
  page.on('framenavigated', onFrameNavigated)
  timer = setTimeout(() => finish(new Error(`Navigation did not occur within ${timeoutMs} ms.`)), timeoutMs)
  timer.unref?.()
  return { promise, dispose: () => finish(new Error('Navigation observation was cancelled.')) }
}

function armDownload(page: Page, timeoutMs: number): { promise: Promise<Download | Error>; dispose(): void } {
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolve!: (outcome: Download | Error) => void
  const onDownload = (download: Download): void => finish(download)
  const cleanup = (): void => { page.off('download', onDownload); if (timer !== undefined) clearTimeout(timer) }
  const finish = (outcome: Download | Error): void => { if (settled) return; settled = true; cleanup(); resolve(outcome) }
  const promise = new Promise<Download | Error>(done => { resolve = done })
  page.on('download', onDownload)
  timer = setTimeout(() => finish(new Error(`Download did not begin within ${timeoutMs} ms.`)), timeoutMs)
  timer.unref?.()
  return { promise, dispose: () => finish(new Error('Download observation was cancelled.')) }
}

const TYPES: Record<PlaywrightEngine, BrowserType> = { chromium, firefox, webkit }
function dshRoot(): string { return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh')) }
function profileRoot(engine: PlaywrightEngine, headed: boolean): string { return join(dshRoot(), 'browser', 'playwright', `${engine}-${headed ? 'headed' : 'headless'}`) }
function artifactsRoot(): string { return join(dshRoot(), 'artifacts', 'browser-downloads') }

/** Convert Desktop-forwarded proxy environment into Playwright's explicit proxy contract. */
export interface ManagedProxySettings { server: string; bypass?: string; username?: string; password?: string }
export function resolvePlaywrightProxy(env: NodeJS.ProcessEnv = process.env): ManagedProxySettings | undefined {
  const raw = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
  if (raw === undefined || raw.trim() === '') return undefined
  let server = raw.trim(); let username: string | undefined; let password: string | undefined
  try {
    const url = new URL(server.includes('://') ? server : `http://${server}`)
    username = url.username === '' ? undefined : decodeURIComponent(url.username)
    password = url.password === '' ? undefined : decodeURIComponent(url.password)
    url.username = ''; url.password = ''; server = url.toString().replace(/\/$/, '')
  } catch { /* Playwright will report an actionable proxy parse error. */ }
  const configuredBypass = (env.NO_PROXY ?? env.no_proxy)?.trim()
  const bypass = configuredBypass === '*' ? '*' : [...new Set(['localhost', '127.0.0.1', '::1', ...(configuredBypass === undefined || configuredBypass === '' ? [] : configuredBypass.split(',').map(item => item.trim()).filter(Boolean))])].join(',')
  return { server, bypass, ...(username === undefined ? {} : { username }), ...(password === undefined ? {} : { password }) }
}

export function classifyHeadlessAccess(input: { status?: number; finalUrl: string; challenge: boolean; authField: boolean; headed: boolean }): BrowserRuntimeError | undefined {
  if (input.headed) return undefined
  const details = { ...(input.status === undefined ? {} : { httpStatus: input.status }), finalUrl: input.finalUrl, suggestedNextStep: 'Switch to a live IAB only when the page requires a challenge or manual authentication.' }
  if (input.status === 401) return new BrowserRuntimeError('AUTH_REQUIRED', 'The server requires authentication. Continue in a live Browser Provider for shielded login.', details)
  if (input.challenge || /(?:captcha|challenge|cdn-cgi\/challenge)/i.test(input.finalUrl)) return new BrowserRuntimeError('HEADLESS_BLOCKED', 'The site presented an anti-automation or CAPTCHA challenge.', { ...details, suggestedNextStep: 'Open the URL in the live IAB and complete the challenge manually.' })
  if (input.authField && /(?:login|log-in|signin|sign-in|auth|verify|otp)/i.test(input.finalUrl)) return new BrowserRuntimeError('AUTH_REQUIRED', 'Authentication requires a live Browser Provider with shielded manual handoff.', details)
  if (input.status === 403) return new BrowserRuntimeError('ACCESS_DENIED', 'The server denied access to this page.', { ...details, suggestedNextStep: 'Verify permissions or try the live IAB if this site treats interactive browsers differently.' })
  return undefined
}

function chromiumSystemCandidates(): string[] {
  const values = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium']
  if (process.platform === 'win32') for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) if (root !== undefined) values.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(root, 'Chromium', 'Application', 'chrome.exe'))
  return values
}

export function resolvePlaywrightExecutable(engine: PlaywrightEngine): { path?: string; diagnostic?: string } {
  const explicit = process.env[`DEEP_CREATOR_BROWSER_${engine.toUpperCase()}_EXECUTABLE`] ?? (engine === 'chromium' ? process.env.DEEP_CREATOR_BROWSER_EXECUTABLE : undefined)
  if (explicit !== undefined) return existsSync(explicit) ? { path: explicit } : { diagnostic: `Configured ${engine} executable does not exist: ${explicit}` }
  const bundled = TYPES[engine].executablePath()
  if (existsSync(bundled)) return { path: bundled }
  if (engine === 'chromium') {
    const system = chromiumSystemCandidates().find(existsSync)
    if (system !== undefined) return { path: system }
  }
  return { diagnostic: `The pinned Playwright ${engine} Browser Pack is not installed. Install it from Browser settings; runtime downloads are disabled.` }
}

export function managedPlaywrightDescriptor(engine: PlaywrightEngine): BrowserDescriptor {
  const executable = resolvePlaywrightExecutable(engine)
  return {
    browserId: `playwright-${engine}`, name: `Managed Playwright ${engine}`, providerKind: 'managed', family: engine as BrowserFamily, profile: 'managed-persistent',
    capabilities: ['core.tabs', 'core.navigation', 'core.snapshot', 'core.screenshot', 'core.semantic-actions', 'core.wait', 'io.upload', 'io.download', 'presentation.snapshot', 'presentation.live', 'automation.playwright', 'management.install'],
    presentation: { owner: 'deepcreator', mode: 'snapshot', requiredBeforeControl: false }, availability: executable.path === undefined ? 'unavailable' : 'available',
    ...(executable.diagnostic === undefined ? {} : { diagnostic: executable.diagnostic }),
  }
}

/** Child-process implementation. Host code talks to it only through PlaywrightOwnerClient. */
export class OwnedPlaywrightProvider implements BrowserProvider {
  readonly #entries = new Map<string, PageEntry>()
  readonly #refs = new Map<string, RefEntry>()
  readonly #persistent = new Map<string, BrowserContext>()
  readonly #routedContexts = new WeakSet<BrowserContext>()
  readonly #network: BrowserNetworkPolicy
  readonly #executable: { path?: string; diagnostic?: string }

  constructor(readonly engine: PlaywrightEngine, networkPolicy: BrowserNetworkPolicy) { this.#network = networkPolicy; this.#executable = resolvePlaywrightExecutable(engine) }

  descriptor(): BrowserDescriptor {
    return managedPlaywrightDescriptor(this.engine)
  }

  async createTab(_context: BrowserProviderContext, request: BrowserTabRequest): Promise<ProviderTab> {
    const requirements = request.requirements ?? {}
    const headed = requirements.visibility === 'live'
    const isolated = requirements.profile === 'isolated'
    const { page, browserContext, browser } = await this.#newPage(headed, isolated)
    const providerTabId = randomUUID()
    const presentation: PresentationBinding = headed
      ? { owner: 'provider', mode: 'live', requiredBeforeControl: false }
      : { owner: 'deepcreator', mode: 'snapshot', requiredBeforeControl: false }
    this.#entries.set(providerTabId, { page, context: browserContext, ...(browser === undefined ? {} : { browser }), ownsContext: isolated, presentation })
    page.on('close', () => { this.#entries.delete(providerTabId); this.#refs.delete(providerTabId) })
    try {
      if (request.url !== undefined) {
        await this.#network.assertAllowed(request.url)
        const response = await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await this.#assertNoHeadlessAuth(page, response?.status(), headed)
      }
    } catch (error) { await this.#closeEntry(providerTabId); throw this.#navigationError(error, page.url()) }
    return this.#state(providerTabId, page, presentation)
  }

  async listAgentTabs(context: BrowserProviderContext): Promise<ProviderTab[]> { void context; return Promise.all([...this.#entries].map(([id, entry]) => this.#state(id, entry.page, entry.presentation))) }
  page(providerTabId: string): Page { return this.#entry(providerTabId).page }
  scriptEnvironment(providerTabId: string): { browser?: Browser; context: BrowserContext; page: Page } {
    const entry = this.#entry(providerTabId)
    const browser = entry.browser ?? entry.context.browser() ?? undefined
    return { ...(browser === undefined ? {} : { browser }), context: entry.context, page: entry.page }
  }
  async adoptPage(page: Page): Promise<ProviderTab> {
    const known = [...this.#entries].find(([, entry]) => entry.page === page)
    if (known !== undefined) return this.#state(known[0], page, known[1].presentation)
    const providerTabId = randomUUID()
    const presentation: PresentationBinding = { owner: 'deepcreator', mode: 'snapshot', requiredBeforeControl: false }
    const sibling = [...this.#entries.values()].find(entry => entry.context === page.context())
    const browser = sibling?.browser ?? page.context().browser() ?? undefined
    this.#entries.set(providerTabId, { page, context: page.context(), ...(browser === undefined ? {} : { browser }), ownsContext: false, presentation })
    page.on('close', () => { this.#entries.delete(providerTabId); this.#refs.delete(providerTabId) })
    return this.#state(providerTabId, page, presentation)
  }
  async observeScriptValue(value: unknown): Promise<ProviderTab[]> {
    const adopted: ProviderTab[] = []
    const seen = new WeakSet<object>()
    const visit = async (candidate: unknown): Promise<void> => {
      if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) return
      const object = candidate as object
      if (seen.has(object)) return
      seen.add(object)
      if (this.#isPage(candidate)) {
        await this.#route(candidate.context())
        adopted.push(await this.adoptPage(candidate))
        return
      }
      if (this.#isContext(candidate)) { await this.#route(candidate); return }
      if (Array.isArray(candidate)) for (const item of candidate) await visit(item)
    }
    await visit(value)
    return adopted
  }

  async execute(context: BrowserProviderContext, tab: ProviderTab, command: BrowserCommand): Promise<BrowserCommandResult> {
    const entry = this.#entry(tab.providerTabId); const page = entry.page
    if (context.signal.aborted) throw new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Browser command was cancelled.')
    if (command.kind === 'navigate') {
      let status: number | undefined
      try {
        if (command.action === 'goto') { if (command.url === undefined) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'goto requires url.'); await this.#network.assertAllowed(command.url); status = (await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }))?.status() }
        else if (command.action === 'back') status = (await page.goBack({ waitUntil: 'domcontentloaded' }))?.status()
        else if (command.action === 'forward') status = (await page.goForward({ waitUntil: 'domcontentloaded' }))?.status()
        else status = (await page.reload({ waitUntil: 'domcontentloaded' }))?.status()
      } catch (error) { throw this.#navigationError(error, page.url()) }
      await this.#assertNoHeadlessAuth(page, status, entry.presentation.mode === 'live')
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    if (command.kind === 'inspect') {
      if (command.action === 'snapshot') return this.#snapshot(tab.providerTabId, page, entry.presentation)
      if (command.action === 'screenshot') { const data = await page.screenshot({ type: 'png' }); return { kind: 'screenshot', dataUrl: `data:image/png;base64,${data.toString('base64')}`, tab: await this.#state(tab.providerTabId, page, entry.presentation) } }
      if (command.action === 'document') {
        const document = await page.evaluate(`(${DOCUMENT_EXTRACTION_SCRIPT})(${JSON.stringify({ documentId: command.documentId, offset: command.offset, maxChars: command.maxChars })})`) as BrowserDocumentScriptResult
        if (document.error === 'STALE_DOCUMENT') throw new BrowserRuntimeError('STALE_DOCUMENT', 'The page changed while continuing this document. Start again without documentId.', { documentId: document.documentId, finalUrl: page.url(), suggestedNextStep: 'Call browser_inspect with action=document and no documentId.' })
        return { kind: 'document', document: { documentId: document.documentId, text: document.text ?? '', offset: document.offset ?? 0, ...(document.nextOffset === undefined ? {} : { nextOffset: document.nextOffset }), truncated: document.truncated ?? false, contentType: document.contentType, ...(document.sourceTruncated === undefined ? {} : { sourceTruncated: document.sourceTruncated }) }, tab: await this.#state(tab.providerTabId, page, entry.presentation) }
      }
      if (command.action === 'elementInfo') { if (command.locator === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', 'elementInfo requires a locator.'); return { kind: 'elementInfo', element: await this.#element(this.#locator(tab.providerTabId, page, command.locator), 'element'), tab: await this.#state(tab.providerTabId, page, entry.presentation) } }
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    if (command.kind === 'wait') {
      const timeout = command.timeoutMs ?? 15_000
      if (command.condition === 'load') await page.waitForLoadState((command.value as 'load' | 'domcontentloaded' | 'networkidle' | undefined) ?? 'domcontentloaded', { timeout })
      else if (command.condition === 'url') await page.waitForURL(url => matchBrowserUrl(url.toString(), command.value ?? '', command.urlMatch), { timeout })
      else if (command.condition === 'dialog') await page.waitForEvent('dialog', { timeout }).then(dialog => dialog.dismiss())
      else { if (command.locator === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', `${command.condition} wait requires a locator.`); await this.#locator(tab.providerTabId, page, command.locator).waitFor({ state: command.condition === 'visible' ? 'visible' : 'hidden', timeout }) }
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    const steps = browserActionSteps(command)
    const download = command.expected === 'download' ? armDownload(page, 30_000) : undefined
    const popupPolicy = command.popupPolicy ?? (command.expected === 'navigation' ? 'same-tab' : 'deny')
    let popup: Page | undefined
    const popupListener = (opened: Page): void => { popup = opened }
    page.on('popup', popupListener)
    const navigation = command.expected === 'navigation' ? armMainFrameNavigation(page, 30_000) : undefined
    try {
      for (const [index, step] of steps.entries()) {
        try {
          const target = step.action === 'scroll' && step.locator === undefined ? page.locator('body') : step.locator === undefined ? undefined : this.#locator(tab.providerTabId, page, step.locator)
          if (target === undefined && step.action !== 'press') throw new BrowserRuntimeError('STALE_SNAPSHOT', `${step.action} requires a locator.`)
          if (target !== undefined) await this.#assertUnique(target)
          if ((step.action === 'click' || (step.action === 'press' && (step.value ?? 'Enter') === 'Enter')) && popupPolicy === 'same-tab' && target !== undefined) await target.evaluate(element => { if (element instanceof HTMLAnchorElement && element.target === '_blank') element.removeAttribute('target') })
          if (step.action === 'click') await target!.click()
          else if (step.action === 'fill') await target!.fill(step.value ?? '')
          else if (step.action === 'type') await target!.pressSequentially(step.value ?? '')
          else if (step.action === 'press') await (target ?? page.locator('body')).press(step.value ?? 'Enter')
          else if (step.action === 'select') await target!.selectOption(step.value ?? '')
          else if (step.action === 'check') await target!.check()
          else if (step.action === 'scroll') await target!.evaluate((element, value) => element.scrollBy(0, Number(value) || 600), step.value ?? '600')
          else if (step.action === 'drag') { if (step.destination === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', 'drag requires a destination locator.'); const destination = this.#locator(tab.providerTabId, page, step.destination); await this.#assertUnique(destination); await target!.dragTo(destination) }
          else if (step.action === 'upload') await target!.setInputFiles(await Promise.all((step.files ?? []).map(path => resolveWorkspaceUpload(context.workspaceRoot, path))))
        } catch (error) {
          if (error instanceof BrowserRuntimeError) throw new BrowserRuntimeError(error.code, error.message, { ...(error.details ?? {}), failedStep: index, completedSteps: index, actionApplied: index > 0, failedPhase: 'action', finalTab: await this.#state(tab.providerTabId, page, entry.presentation) })
          throw new BrowserRuntimeError('BROWSER_UNAVAILABLE', `Browser action step ${index + 1} (${step.action}) failed: ${error instanceof Error ? error.message : String(error)}`, { failedStep: index, completedSteps: index, actionApplied: index > 0, failedPhase: 'action', finalTab: await this.#state(tab.providerTabId, page, entry.presentation) })
        }
      }
      if (popup !== undefined) {
        const popupUrl = popup.url()
        if (popupPolicy === 'deny') { await popup.close().catch(() => undefined); throw new BrowserRuntimeError('POPUP_BLOCKED', 'The action requested a new page, but popupPolicy=deny. No navigation wait was performed.', { popupUrl, completedSteps: steps.length, actionApplied: true, failedPhase: 'postcondition', postcondition: 'navigation', finalTab: await this.#state(tab.providerTabId, page, entry.presentation), suggestedNextStep: 'Retry once with popupPolicy=same-tab, or navigate directly to the inspected link href.' }) }
        await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
        const adoptedUrl = popup.url(); await popup.close().catch(() => undefined); popup = undefined
        if (adoptedUrl !== '' && adoptedUrl !== 'about:blank') await page.goto(adoptedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      }
      if (navigation !== undefined) {
        const postconditionStartedAt = Date.now(); const outcome = await navigation.promise
        if (outcome instanceof Error) throw new BrowserRuntimeError('POSTCONDITION_TIMEOUT', `Action completed (${steps.length}/${steps.length} steps), but the navigation postcondition did not occur. The mutation was applied and the previous snapshot is invalid.`, { completedSteps: steps.length, actionApplied: true, failedPhase: 'postcondition', postcondition: 'navigation', durationMs: Date.now() - postconditionStartedAt, finalUrl: page.url(), finalTab: await this.#state(tab.providerTabId, page, entry.presentation), suggestedNextStep: 'Inspect Browser events and the current URL; do not retry the mutation or add a fixed sleep.' })
        await page.waitForLoadState('domcontentloaded', { timeout: 30_000 })
      }
      if (command.expectedUrl !== undefined) {
        const postconditionStartedAt = Date.now()
        try { await page.waitForURL(url => matchBrowserUrl(url.toString(), command.expectedUrl!, command.urlMatch), { timeout: 30_000 }) }
        catch { throw new BrowserRuntimeError('POSTCONDITION_TIMEOUT', `Action completed (${steps.length}/${steps.length} steps), but the URL postcondition was not satisfied. The mutation was applied and the previous snapshot is invalid.`, { completedSteps: steps.length, actionApplied: true, failedPhase: 'postcondition', postcondition: 'url', durationMs: Date.now() - postconditionStartedAt, finalUrl: page.url(), finalTab: await this.#state(tab.providerTabId, page, entry.presentation), suggestedNextStep: 'Inspect Browser events and the current URL; do not retry the mutation or add a fixed sleep.' }) }
      }
      if (download !== undefined) {
        const postconditionStartedAt = Date.now()
        try { const received = await download.promise; if (received instanceof Error) throw received; const artifactId = `browser-download-${randomUUID()}`; const root = artifactsRoot(); await mkdir(root, { recursive: true, mode: 0o700 }); const fileName = basename(received.suggestedFilename()); await received.saveAs(join(root, `${artifactId}-${fileName}`)); return { kind: 'download', artifactId, fileName, tab: await this.#state(tab.providerTabId, page, entry.presentation) } }
        catch { throw new BrowserRuntimeError('POSTCONDITION_TIMEOUT', `Action completed (${steps.length}/${steps.length} steps), but the download postcondition timed out.`, { completedSteps: steps.length, actionApplied: true, failedPhase: 'postcondition', postcondition: 'download', durationMs: Date.now() - postconditionStartedAt, finalTab: await this.#state(tab.providerTabId, page, entry.presentation) }) }
      }
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    } finally {
      page.off('popup', popupListener)
      navigation?.dispose()
      download?.dispose()
      if (popup !== undefined && !popup.isClosed()) await popup.close().catch(() => undefined)
    }
  }

  async show(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { void context; const entry = this.#entry(tab.providerTabId); await entry.page.bringToFront(); return this.#state(tab.providerTabId, entry.page, entry.presentation) }
  async release(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.close(context, tab) }
  async close(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { void context; await this.#closeEntry(tab.providerTabId) }
  async dispose(): Promise<void> { for (const id of [...this.#entries.keys()]) await this.#closeEntry(id); for (const context of this.#persistent.values()) await context.close().catch(() => undefined); this.#persistent.clear() }
  async clearData(): Promise<void> { await this.dispose(); await rm(join(dshRoot(), 'browser', 'playwright', this.engine), { recursive: true, force: true }); for (const headed of [false, true]) await rm(profileRoot(this.engine, headed), { recursive: true, force: true }) }

  async #newPage(headed: boolean, isolated: boolean): Promise<{ page: Page; browserContext: BrowserContext; browser?: Browser }> {
    if (this.#executable.path === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', this.#executable.diagnostic ?? `${this.engine} unavailable.`)
    const browserType = TYPES[this.engine]
    const proxy = resolvePlaywrightProxy()
    if (isolated) {
      const browser = await browserType.launch({ executablePath: this.#executable.path, headless: !headed, ...(proxy === undefined ? {} : { proxy }) })
      const browserContext = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', ...(proxy === undefined ? {} : { proxy }) })
      await this.#route(browserContext); return { page: await browserContext.newPage(), browserContext, browser }
    }
    const key = headed ? 'headed' : 'headless'; let browserContext = this.#persistent.get(key)
    if (browserContext === undefined) {
      await mkdir(profileRoot(this.engine, headed), { recursive: true, mode: 0o700 })
      try { browserContext = await browserType.launchPersistentContext(profileRoot(this.engine, headed), { executablePath: this.#executable.path, headless: !headed, acceptDownloads: true, downloadsPath: artifactsRoot(), serviceWorkers: 'block', ...(proxy === undefined ? {} : { proxy }) }); await this.#route(browserContext); this.#persistent.set(key, browserContext) }
      catch (error) { if (/profile|lock|SingletonLock/i.test(String(error))) throw new BrowserRuntimeError('PROFILE_LOCKED', `The managed ${this.engine} profile is already in use.`); throw error }
    }
    return { page: await browserContext.newPage(), browserContext }
  }
  async #route(context: BrowserContext): Promise<void> {
    if (this.#routedContexts.has(context)) return
    await context.route('**/*', async route => { try { await this.#network.assertAllowed(route.request().url()); await route.continue() } catch { await route.abort('blockedbyclient') } })
    this.#routedContexts.add(context)
  }
  async #closeEntry(id: string): Promise<void> { const entry = this.#entries.get(id); this.#entries.delete(id); this.#refs.delete(id); if (entry === undefined) return; await entry.page.close().catch(() => undefined); if (entry.ownsContext) { await entry.context.close().catch(() => undefined); await entry.browser?.close().catch(() => undefined) } }
  #entry(id: string): PageEntry { const entry = this.#entries.get(id); if (entry === undefined || entry.page.isClosed()) throw new BrowserRuntimeError('TAB_NOT_FOUND', `Provider tab ${id} is gone.`); return entry }
  async #state(id: string, page: Page, presentation: PresentationBinding): Promise<ProviderTab> { return { providerTabId: id, url: page.url(), title: await page.title(), loading: false, canGoBack: false, canGoForward: false, presentation } }
  async #snapshot(id: string, page: Page, presentation: PresentationBinding): Promise<BrowserCommandResult> { const snapshotId = `snapshot-${randomUUID()}`; const rows = await page.evaluate(`(${INTERACTIVE_SNAPSHOT_SCRIPT})()`) as BrowserSnapshotScriptRow[]; const selectors = new Map<string, string>(); const nodes: BrowserNodeRef[] = rows.map((row, index) => { const nodeRef = `n${index + 1}`; selectors.set(nodeRef, row.selector); return { nodeRef, role: row.role, name: row.name, ...(row.stableLocators === undefined ? {} : { stableLocators: row.stableLocators }), ...(row.value === undefined ? {} : { value: row.value }), ...(row.inputType === undefined ? {} : { inputType: row.inputType }), ...(row.autocomplete === undefined ? {} : { autocomplete: row.autocomplete }), ...(row.href === undefined ? {} : { href: row.href }), ...(row.target === undefined ? {} : { target: row.target }), ...(row.opensNewTab === undefined ? {} : { opensNewTab: row.opensNewTab }), ...(row.formAction === undefined ? {} : { formAction: row.formAction }), ...(row.formMethod === undefined ? {} : { formMethod: row.formMethod }) } }); this.#refs.set(id, { snapshotId, selectors }); return { kind: 'snapshot', snapshot: { snapshotId, url: page.url(), title: await page.title(), text: nodes.map(node => `${node.nodeRef} ${node.role ?? 'element'} ${JSON.stringify(node.name ?? '')}${node.stableLocators?.[0] === undefined ? '' : ` stable=${JSON.stringify(node.stableLocators[0])}`}`).join('\n'), nodes }, tab: await this.#state(id, page, presentation) } }
  #locator(id: string, page: Page, locator: BrowserLocator): Locator { if (locator.kind === 'node') { const refs = this.#refs.get(id); if (refs?.snapshotId !== locator.snapshotId) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Snapshot ${locator.snapshotId} is stale.`); const selector = refs.selectors.get(locator.nodeRef); if (selector === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Node ${locator.nodeRef} is absent.`); return page.locator(selector) } if (locator.kind === 'role') return page.getByRole(locator.role as never, locator.name === undefined ? {} : { name: locator.name, exact: locator.exact ?? false }); if (locator.kind === 'text') return page.getByText(locator.text, { exact: locator.exact ?? false }); return page.getByLabel(locator.label) }
  async #assertUnique(locator: Locator): Promise<void> { const count = await locator.count(); if (count > 1) throw new BrowserRuntimeError('AMBIGUOUS_LOCATOR', `Locator matched ${count} elements. Use a unique snapshot nodeRef or a more specific exact locator.`) }
  async #element(locator: Locator, nodeRef: string): Promise<BrowserNodeRef> { await this.#assertUnique(locator); return locator.evaluate((element, ref) => { const input = element as HTMLInputElement; const inputType = input.type || undefined; const autocomplete = input.autocomplete || undefined; const tag = element.tagName.toLowerCase(); const type = String(input.type || 'text').toLowerCase(); const role = element.getAttribute('role') ?? (tag === 'a' && element.hasAttribute('href') ? 'link' : tag === 'button' ? 'button' : tag === 'textarea' ? 'textbox' : tag === 'select' ? ((input as unknown as HTMLSelectElement).multiple || (input as unknown as HTMLSelectElement).size > 1 ? 'listbox' : 'combobox') : tag === 'input' ? (['button', 'submit', 'reset', 'image'].includes(type) ? 'button' : type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'range' ? 'slider' : type === 'number' ? 'spinbutton' : type === 'search' ? 'searchbox' : 'textbox') : tag); const name = element.getAttribute('aria-label') ?? input.labels?.[0]?.innerText?.trim() ?? (element as HTMLElement).innerText?.trim() ?? input.placeholder ?? ''; const anchor = element instanceof HTMLAnchorElement ? element : undefined; const form = element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element.form : undefined; return { nodeRef: ref, role, name, stableLocators: name === '' ? [] : [{ kind: 'role' as const, role, name, exact: true as const }], ...(inputType === undefined ? {} : { inputType }), ...(autocomplete === undefined ? {} : { autocomplete }), ...(anchor?.href ? { href: anchor.href } : {}), ...(anchor?.target ? { target: anchor.target, opensNewTab: anchor.target === '_blank' } : {}), ...(form?.action ? { formAction: form.action } : {}), ...(form?.method ? { formMethod: form.method.toUpperCase() } : {}) } }, nodeRef) }
  async #assertNoHeadlessAuth(page: Page, status: number | undefined, headed: boolean): Promise<void> {
    if (headed) return
    const finalUrl = page.url()
    if (status === 401) throw classifyHeadlessAccess({ status, finalUrl, challenge: false, authField: false, headed })!
    const challenge = await page.locator('iframe[src*="challenge"],#challenge-form,.cf-challenge,[data-sitekey],input[name="cf-turnstile-response"],iframe[src*="captcha" i]').first().isVisible().catch(() => false)
    const authField = await page.locator('input[type="password"],input[autocomplete="one-time-code"]').first().isVisible().catch(() => false)
    const error = classifyHeadlessAccess({ ...(status === undefined ? {} : { status }), finalUrl, challenge, authField, headed })
    if (error !== undefined) throw error
  }
  #navigationError(error: unknown, finalUrl: string): unknown {
    if (error instanceof BrowserRuntimeError) return error
    const message = error instanceof Error ? error.message : String(error)
    const suggestedNextStep = 'Verify the proxy and endpoint, then retry once or switch to the live IAB for an interactive diagnosis.'
    if (/(?:ERR_CONTENT_DECODING_FAILED|decompress)/i.test(message)) return new BrowserRuntimeError('TIMEOUT', `Navigation failed while decompressing the response: ${message}`, { finalUrl, timeoutPhase: 'decompress', receivedBytes: 0, suggestedNextStep })
    if (/(?:ERR_CONNECTION|ECONN|ENOTFOUND|ERR_PROXY|ERR_TUNNEL)/i.test(message)) return new BrowserRuntimeError('PROVIDER_UNAVAILABLE', `Navigation could not establish a connection: ${message}`, { finalUrl, timeoutPhase: 'connect', receivedBytes: 0, suggestedNextStep })
    if (/timeout/i.test(message)) return new BrowserRuntimeError('TIMEOUT', `Navigation exceeded its total timeout: ${message}`, { finalUrl, timeoutPhase: 'total', receivedBytes: 0, suggestedNextStep })
    return error
  }
  #isPage(value: unknown): value is Page { return value !== null && typeof value === 'object' && typeof (value as Page).url === 'function' && typeof (value as Page).context === 'function' && typeof (value as Page).locator === 'function' }
  #isContext(value: unknown): value is BrowserContext { return value !== null && typeof value === 'object' && typeof (value as BrowserContext).pages === 'function' && typeof (value as BrowserContext).route === 'function' }
}
