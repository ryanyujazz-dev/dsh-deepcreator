#!/usr/bin/env electron
/**
 * DeepCreator personal desktop application. Electron owns the native
 * window and one child process; the child boots the existing Cordis Web
 * profile, preserving the same Host and Client plugin graphs as the browser.
 */

import { join } from 'node:path'
import { createRequire } from 'node:module'
import { app, BrowserWindow, dialog, shell, type Event } from 'electron'
import { resolveDesktopDshLaunch, resolveDesktopWorkspace } from './dsh-launch.ts'
import { startDesktopHost, type DesktopHost } from './host-process.ts'
import { nativeWindowChromeOptions } from './window-options.ts'
import { BrowserViewManager } from './browser-views.ts'

const require = createRequire(import.meta.url)
const APP_NAME = 'DeepCreator'
const USER_DATA_DIRECTORY = 'DeepCreator DSH'
const STARTUP_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 10_000

let mainWindow: BrowserWindow | undefined
let host: DesktopHost | undefined
let shutdownStarted = false
let browserViews: BrowserViewManager | undefined

/** Restrict renderer navigation to the exact loopback origin that became ready. */
function guardNavigation(window: BrowserWindow, trusted: URL): void {
  const allow = (target: string): boolean => {
    try {
      return new URL(target).origin === trusted.origin
    } catch {
      return false
    }
  }
  const preventUntrusted = (event: Event, target: string): void => {
    if (!allow(target)) event.preventDefault()
  }
  window.webContents.on('will-navigate', preventUntrusted)
  window.webContents.on('will-redirect', preventUntrusted)
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' || target.protocol === 'http:') {
        void shell.openExternal(target.href)
      }
    } catch {
      // A malformed renderer target is denied without reaching the OS.
    }
    return { action: 'deny' }
  })
}

/** Create the sandboxed Web renderer after the Cordis Host is ready. */
async function createWindow(activeHost: DesktopHost): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    title: APP_NAME,
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d10',
    ...nativeWindowChromeOptions(process.platform),
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  guardNavigation(window, activeHost.url)
  browserViews = new BrowserViewManager(window)
  browserViews.install()
  window.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    window.setTitle(title.replace(/DeepSeek Harness$/, APP_NAME))
  })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    browserViews?.dispose()
    browserViews = undefined
    if (mainWindow === window) mainWindow = undefined
  })
  await window.loadURL(activeHost.url.href)
  return window
}

/** Start the Host child and native window as one application lifecycle. */
async function start(): Promise<void> {
  const launch = resolveDesktopDshLaunch(
    require.resolve('@deepseek-ai/dsh/package.json'),
    process.env,
  )
  const activeHost = await startDesktopHost({
    command: launch.command,
    args: launch.args,
    cwd: resolveDesktopWorkspace(process.env, process.cwd()),
    env: launch.env,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    onStdout: (line) => { console.log(`[dsh-host] ${line}`) },
    onStderr: (chunk) => { process.stderr.write(`[dsh-host] ${chunk}`) },
  })
  host = activeHost
  try {
    mainWindow = await createWindow(activeHost)
  } catch (error) {
    await activeHost.stop()
    host = undefined
    throw error
  }
  void activeHost.exited.then(({ code, signal }) => {
    if (shutdownStarted || host !== activeHost) return
    host = undefined
    dialog.showErrorBox(
      'DeepCreator 已停止',
      `后台服务意外退出（code ${String(code)}, signal ${String(signal)}）。`,
    )
    app.exit(1)
  })
}

app.setName(APP_NAME)
// Keep this Harness-based desktop isolated from earlier local applications
// that also used the public DeepCreator product name.
app.setPath('userData', join(app.getPath('appData'), USER_DATA_DIRECTORY))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.on('window-all-closed', () => { app.quit() })
  app.on('before-quit', (event) => {
    if (host === undefined || shutdownStarted) return
    event.preventDefault()
    shutdownStarted = true
    void host.stop().finally(() => {
      host = undefined
      app.quit()
    })
  })

  // Complete ESM evaluation before Electron dispatches application readiness.
  void app.whenReady().then(start).catch((error: unknown) => {
    dialog.showErrorBox('DeepCreator 无法启动', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })
}
