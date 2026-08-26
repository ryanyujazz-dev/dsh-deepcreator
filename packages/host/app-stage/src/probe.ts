/**
 * Browser-backed staging probe (M3 / S2 + M4 channel 1): loads a staged
 * snapshot in a private headless Chromium and machine-verifies the gate
 * facts that need a real runtime — the entry actually serves and renders
 * (fetch + MIME + first paint), and dual-channel admission over the bridge
 * protocol (interception is on `window.postMessage`, exactly the wire the
 * production bridge speaks): channel 1, every action the manifest declares
 * has a registered handler (action.register, never invoked — the probe
 * drives nothing); channel 2, the app's own code subscribes to ≥1 AppData
 * key. Either channel admits; neither rejects.
 *
 * The probe browser is private to the publish gate: launched, measured,
 * disposed. Screenshot capture is best-effort — failure degrades to
 * icon + name on the approval card and never blocks publishing.
 * @module @ryanyujazz/dsh-app-stage/probe
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import type { AppProbeReport } from './types.ts'
import { storeRoot, dshHome } from './store.ts'

/** How long the probe waits for a subscription to fire (bridge poll cadence-free). */
export const PROBE_SUBSCRIBE_WAIT_MS = 2500
/** Hard page-load timeout. */
export const PROBE_LOAD_TIMEOUT_MS = 15_000

function chromiumExecutable(): string | undefined {
  const explicit = process.env.DEEP_CREATOR_BROWSER_CHROMIUM_EXECUTABLE ?? process.env.DEEP_CREATOR_BROWSER_EXECUTABLE
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) return explicit
  try {
    const bundled = chromium.executablePath()
    if (existsSync(bundled)) return bundled
  } catch { /* registry miss: fall through to system candidates */ }
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(candidate => existsSync(candidate))
}

/** Init script: record bridge ops the app itself issues (both admission
 * channels' evidence: data.subscribe paths and action.register names). */
const PROBE_INIT = `(() => {
  const ops = []
  const orig = window.postMessage ? window.postMessage.bind(window) : null
  if (orig) {
    window.postMessage = (message, ...rest) => {
      try {
        if (message && typeof message === 'object' && message.__appStage === 1 && typeof message.op === 'string') {
          ops.push({ op: message.op, path: typeof message.path === 'string' ? message.path : null, action: typeof message.action === 'string' ? message.action : null })
        }
      } catch {}
      return orig(message, ...rest)
    }
  }
  window.__stageProbe = ops
})()`

export interface ProbeInput {
  /** Absolute entry URL on the loopback static origin. */
  entryURL: string
  /** Expected MIME of the entry document. */
  entryMIME: string
  /** App id + version (screenshot naming). */
  appId: string
  version: string
  /** Action names the manifest declares (channel-1 expectations: each must
   * be registered by the staging instance's own code). */
  declaredActions?: readonly string[]
  /** DSH home for the screenshot output directory. */
  home?: string
}

/**
 * Run the staging probe. Every failure is reported, never thrown: a failed
 * probe is a `PROBE_FAILED` publish-gate fact with its report attached.
 */
export async function probeStaging(input: ProbeInput): Promise<AppProbeReport & { screenshotPath?: string }> {
  const executable = chromiumExecutable()
  if (executable === undefined) {
    return { ok: false, entryLoaded: false, subscribedKeys: [], registeredActions: [], consoleErrors: [], screenshotTaken: false, detail: 'no Chromium executable found for the staging probe (set DEEP_CREATOR_BROWSER_CHROMIUM_EXECUTABLE)' }
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ executablePath: executable, headless: true })
    const context = await browser.newContext({ viewport: { width: 960, height: 640 } })
    const page = await context.newPage()
    const consoleErrors: string[] = []
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200))
    })
    page.on('pageerror', error => consoleErrors.push(String(error).slice(0, 200)))
    await page.addInitScript(PROBE_INIT)

    const response = await page.goto(input.entryURL, { timeout: PROBE_LOAD_TIMEOUT_MS, waitUntil: 'load' })
    const status = response?.status() ?? 0
    const mime = (response?.headers()['content-type'] ?? '').split(';')[0]!.trim()
    const entryLoaded = status === 200 && mime === input.entryMIME
    if (!entryLoaded) {
      return { ok: false, entryLoaded: false, subscribedKeys: [], registeredActions: [], consoleErrors, screenshotTaken: false, detail: `entry fetch failed: status ${status}, content-type "${mime}" (expected ${input.entryMIME})` }
    }

    await page.waitForTimeout(PROBE_SUBSCRIBE_WAIT_MS)
    const ops = await page.evaluate(() => {
      const probe = (globalThis as { __stageProbe?: { op: string; path: string | null; action: string | null }[] }).__stageProbe
      return probe ?? []
    })
    const subscribedKeys = [...new Set(ops.filter(op => op.op === 'data.subscribe').map(op => op.path).filter((path): path is string => path !== null))]
    const registeredActions = [...new Set(ops.filter(op => op.op === 'action.register').map(op => op.action).filter((action): action is string => action !== null))]

    let screenshotTaken = false
    let screenshotPath: string | undefined
    try {
      const dir = join(storeRoot(input.home ?? dshHome()), 'apps', 'staging-shots')
      await mkdir(dir, { recursive: true })
      screenshotPath = join(dir, `${input.appId}-${input.version.replace(/[^a-zA-Z0-9.-]/g, '_')}.png`)
      await page.screenshot({ path: screenshotPath })
      await writeFile(join(dir, `${input.appId}.latest.json`), `${JSON.stringify({ appId: input.appId, version: input.version, at: new Date().toISOString() }, null, 2)}\n`)
      screenshotTaken = true
    } catch { /* screenshot degrades to icon + name */ }

    // Channel 1: every declared action must have a registered handler —
    // a declared-but-unregistered action is a broken tool API, a hard fail
    // even when channel 2 is met. The probe never invokes handlers.
    const declared = input.declaredActions ?? []
    const missingHandlers = declared.filter(action => !registeredActions.includes(action))
    if (missingHandlers.length > 0) {
      return { ok: false, entryLoaded: true, subscribedKeys, registeredActions, consoleErrors, screenshotTaken, ...(screenshotPath === undefined ? {} : { screenshotPath }), detail: `channel 1 unmet: declared actions without registered handlers: ${missingHandlers.join(', ')} (register every declared action over the bridge, or remove the declaration)` }
    }
    const channelOne = declared.length > 0
    const channelTwo = subscribedKeys.length > 0
    if (!channelOne && !channelTwo) {
      return { ok: false, entryLoaded: true, subscribedKeys, registeredActions, consoleErrors, screenshotTaken, ...(screenshotPath === undefined ? {} : { screenshotPath }), detail: 'dual-channel admission unmet: register ≥1 declared action handler, or subscribe to ≥1 AppData key over the bridge' }
    }
    return { ok: true, entryLoaded: true, subscribedKeys, registeredActions, consoleErrors: consoleErrors.slice(0, 8), screenshotTaken, ...(screenshotPath === undefined ? {} : { screenshotPath }) }
  } catch (error) {
    return { ok: false, entryLoaded: false, subscribedKeys: [], registeredActions: [], consoleErrors: [], screenshotTaken: false, detail: `probe failed: ${error instanceof Error ? error.message : String(error)}` }
  } finally {
    try { await browser?.close() } catch { /* already gone */ }
  }
}

/** Exported for tests: the interception script contract. */
export const PROBE_INIT_SCRIPT = PROBE_INIT
