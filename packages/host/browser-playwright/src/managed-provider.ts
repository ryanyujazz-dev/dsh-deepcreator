import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  chromium, firefox, webkit, type Browser, type BrowserContext, type BrowserType, type Download, type Locator, type Page,
} from 'playwright-core'
import {
  BrowserNetworkPolicy, BrowserRuntimeError, INTERACTIVE_SNAPSHOT_SCRIPT, resolveWorkspaceUpload,
  type BrowserCommand, type BrowserCommandResult, type BrowserDescriptor, type BrowserFamily, type BrowserLocator,
  type BrowserNodeRef, type BrowserProvider, type BrowserProviderContext,
  type BrowserSnapshotScriptRow, type BrowserTabRequest, type PresentationBinding, type ProviderTab,
} from '@ryanyujazz/dsh-browser'

export type PlaywrightEngine = 'chromium' | 'firefox' | 'webkit'
interface RefEntry { snapshotId: string; selectors: Map<string, string> }
interface PageEntry { page: Page; context: BrowserContext; browser?: Browser; ownsContext: boolean; presentation: PresentationBinding }

const TYPES: Record<PlaywrightEngine, BrowserType> = { chromium, firefox, webkit }
function dshRoot(): string { return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh')) }
function profileRoot(engine: PlaywrightEngine, headed: boolean): string { return join(dshRoot(), 'browser', 'playwright', `${engine}-${headed ? 'headed' : 'headless'}`) }
function artifactsRoot(): string { return join(dshRoot(), 'artifacts', 'browser-downloads') }

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
    } catch (error) { await this.#closeEntry(providerTabId); throw error }
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
      if (command.action === 'goto') { if (command.url === undefined) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'goto requires url.'); await this.#network.assertAllowed(command.url); status = (await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: 30_000 }))?.status() }
      else if (command.action === 'back') status = (await page.goBack({ waitUntil: 'domcontentloaded' }))?.status()
      else if (command.action === 'forward') status = (await page.goForward({ waitUntil: 'domcontentloaded' }))?.status()
      else status = (await page.reload({ waitUntil: 'domcontentloaded' }))?.status()
      await this.#assertNoHeadlessAuth(page, status, entry.presentation.mode === 'live')
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    if (command.kind === 'inspect') {
      if (command.action === 'snapshot') return this.#snapshot(tab.providerTabId, page, entry.presentation)
      if (command.action === 'screenshot') { const data = await page.screenshot({ type: 'png' }); return { kind: 'screenshot', dataUrl: `data:image/png;base64,${data.toString('base64')}`, tab: await this.#state(tab.providerTabId, page, entry.presentation) } }
      if (command.action === 'elementInfo') { if (command.locator === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', 'elementInfo requires a locator.'); return { kind: 'elementInfo', element: await this.#element(this.#locator(tab.providerTabId, page, command.locator), 'element'), tab: await this.#state(tab.providerTabId, page, entry.presentation) } }
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    if (command.kind === 'wait') {
      const timeout = command.timeoutMs ?? 15_000
      if (command.condition === 'load') await page.waitForLoadState((command.value as 'load' | 'domcontentloaded' | 'networkidle' | undefined) ?? 'domcontentloaded', { timeout })
      else if (command.condition === 'url') await page.waitForURL(command.value ?? '**', { timeout })
      else if (command.condition === 'dialog') await page.waitForEvent('dialog', { timeout }).then(dialog => dialog.dismiss())
      else { if (command.locator === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', `${command.condition} wait requires a locator.`); await this.#locator(tab.providerTabId, page, command.locator).waitFor({ state: command.condition === 'visible' ? 'visible' : 'hidden', timeout }) }
      return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    const target = command.action === 'scroll' && command.locator === undefined ? page.locator('body') : command.locator === undefined ? undefined : this.#locator(tab.providerTabId, page, command.locator)
    if (target === undefined && command.action !== 'press') throw new BrowserRuntimeError('STALE_SNAPSHOT', `${command.action} requires a locator.`)
    let downloadPromise: Promise<Download> | undefined
    if (command.expected === 'download') downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    if (command.action === 'click') await target!.click()
    else if (command.action === 'fill') await target!.fill(command.value ?? '')
    else if (command.action === 'type') await target!.pressSequentially(command.value ?? '')
    else if (command.action === 'press') await (target ?? page.locator('body')).press(command.value ?? 'Enter')
    else if (command.action === 'select') await target!.selectOption(command.value ?? '')
    else if (command.action === 'check') await target!.check()
    else if (command.action === 'scroll') await target!.evaluate((element, value) => element.scrollBy(0, Number(value) || 600), command.value ?? '600')
    else if (command.action === 'drag') { if (command.destination === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', 'drag requires a destination locator.'); await target!.dragTo(this.#locator(tab.providerTabId, page, command.destination)) }
    else if (command.action === 'upload') await target!.setInputFiles(await Promise.all((command.files ?? []).map(path => resolveWorkspaceUpload(context.workspaceRoot, path))))
    if (command.expected === 'navigation') await page.waitForLoadState('domcontentloaded', { timeout: 30_000 })
    if (downloadPromise !== undefined) {
      const download = await downloadPromise; const artifactId = `browser-download-${randomUUID()}`; const root = artifactsRoot(); await mkdir(root, { recursive: true, mode: 0o700 }); const fileName = basename(download.suggestedFilename()); await download.saveAs(join(root, `${artifactId}-${fileName}`))
      return { kind: 'download', artifactId, fileName, tab: await this.#state(tab.providerTabId, page, entry.presentation) }
    }
    return { kind: 'state', tab: await this.#state(tab.providerTabId, page, entry.presentation) }
  }

  async show(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab> { void context; const entry = this.#entry(tab.providerTabId); await entry.page.bringToFront(); return this.#state(tab.providerTabId, entry.page, entry.presentation) }
  async release(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { await this.close(context, tab) }
  async close(context: BrowserProviderContext, tab: ProviderTab): Promise<void> { void context; await this.#closeEntry(tab.providerTabId) }
  async dispose(): Promise<void> { for (const id of [...this.#entries.keys()]) await this.#closeEntry(id); for (const context of this.#persistent.values()) await context.close().catch(() => undefined); this.#persistent.clear() }
  async clearData(): Promise<void> { await this.dispose(); await rm(join(dshRoot(), 'browser', 'playwright', this.engine), { recursive: true, force: true }); for (const headed of [false, true]) await rm(profileRoot(this.engine, headed), { recursive: true, force: true }) }

  async #newPage(headed: boolean, isolated: boolean): Promise<{ page: Page; browserContext: BrowserContext; browser?: Browser }> {
    if (this.#executable.path === undefined) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', this.#executable.diagnostic ?? `${this.engine} unavailable.`)
    const browserType = TYPES[this.engine]
    if (isolated) {
      const browser = await browserType.launch({ executablePath: this.#executable.path, headless: !headed })
      const browserContext = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block' })
      await this.#route(browserContext); return { page: await browserContext.newPage(), browserContext, browser }
    }
    const key = headed ? 'headed' : 'headless'; let browserContext = this.#persistent.get(key)
    if (browserContext === undefined) {
      await mkdir(profileRoot(this.engine, headed), { recursive: true, mode: 0o700 })
      try { browserContext = await browserType.launchPersistentContext(profileRoot(this.engine, headed), { executablePath: this.#executable.path, headless: !headed, acceptDownloads: true, downloadsPath: artifactsRoot(), serviceWorkers: 'block' }); await this.#route(browserContext); this.#persistent.set(key, browserContext) }
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
  async #snapshot(id: string, page: Page, presentation: PresentationBinding): Promise<BrowserCommandResult> { const snapshotId = `snapshot-${randomUUID()}`; const rows = await page.evaluate(`(${INTERACTIVE_SNAPSHOT_SCRIPT})()`) as BrowserSnapshotScriptRow[]; const selectors = new Map<string, string>(); const nodes: BrowserNodeRef[] = rows.map((row, index) => { const nodeRef = `n${index + 1}`; selectors.set(nodeRef, row.selector); return { nodeRef, role: row.role, name: row.name, ...(row.value === undefined ? {} : { value: row.value }), ...(row.inputType === undefined ? {} : { inputType: row.inputType }), ...(row.autocomplete === undefined ? {} : { autocomplete: row.autocomplete }) } }); this.#refs.set(id, { snapshotId, selectors }); return { kind: 'snapshot', snapshot: { snapshotId, url: page.url(), title: await page.title(), text: nodes.map(node => `${node.nodeRef} ${node.role ?? 'element'} ${JSON.stringify(node.name ?? '')}`).join('\n'), nodes }, tab: await this.#state(id, page, presentation) } }
  #locator(id: string, page: Page, locator: BrowserLocator): Locator { if (locator.kind === 'node') { const refs = this.#refs.get(id); if (refs?.snapshotId !== locator.snapshotId) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Snapshot ${locator.snapshotId} is stale.`); const selector = refs.selectors.get(locator.nodeRef); if (selector === undefined) throw new BrowserRuntimeError('STALE_SNAPSHOT', `Node ${locator.nodeRef} is absent.`); return page.locator(selector).first() } if (locator.kind === 'role') return page.getByRole(locator.role as never, locator.name === undefined ? {} : { name: locator.name }).first(); if (locator.kind === 'text') return page.getByText(locator.text, { exact: locator.exact ?? false }).first(); return page.getByLabel(locator.label).first() }
  async #element(locator: Locator, nodeRef: string): Promise<BrowserNodeRef> { return locator.evaluate((element, ref) => { const input = element as HTMLInputElement; const inputType = input.type || undefined; const autocomplete = input.autocomplete || undefined; return { nodeRef: ref, role: element.getAttribute('role') ?? element.tagName.toLowerCase(), name: element.getAttribute('aria-label') ?? (element as HTMLElement).innerText?.trim() ?? input.placeholder ?? '', ...(inputType === undefined ? {} : { inputType }), ...(autocomplete === undefined ? {} : { autocomplete }) } }, nodeRef) }
  async #assertNoHeadlessAuth(page: Page, status: number | undefined, headed: boolean): Promise<void> { if (headed) return; if (status === 401 || status === 403) throw new BrowserRuntimeError('AUTH_REQUIRED', 'This page requires a live Browser Provider for manual login.'); if (/(login|log-in|signin|sign-in|auth)/i.test(page.url()) && await page.locator('input[type="password"],input[autocomplete="one-time-code"]').first().isVisible().catch(() => false)) throw new BrowserRuntimeError('AUTH_REQUIRED', 'Authentication requires a live Browser Provider with shielded manual handoff.') }
  #isPage(value: unknown): value is Page { return value !== null && typeof value === 'object' && typeof (value as Page).url === 'function' && typeof (value as Page).context === 'function' && typeof (value as Page).locator === 'function' }
  #isContext(value: unknown): value is BrowserContext { return value !== null && typeof value === 'object' && typeof (value as BrowserContext).pages === 'function' && typeof (value as BrowserContext).route === 'function' }
}
