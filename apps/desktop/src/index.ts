#!/usr/bin/env electron
/**
 * DeepCreator personal desktop application. Electron owns the native
 * window and one child process; the child boots the existing Cordis Web
 * profile, preserving the same Host and Client plugin graphs as the browser.
 */

import { join } from 'node:path'
import { createRequire } from 'node:module'
import { app, BrowserWindow, dialog, session, shell, type Event } from 'electron'
import { resolveDesktopDshLaunch, resolveDesktopWorkspace, resolveSystemProxyEnvironment } from './dsh-launch.ts'
import { startDesktopHost, type DesktopHost } from './host-process.ts'
import { nativeWindowChromeOptions } from './window-options.ts'
import { BrowserRpcServer } from './browser-rpc-server.ts'
import { BrowserSurfaceDriver } from './browser-views.ts'
import { TitleBarThemeBridge } from './titlebar-theme.ts'
import { WindowStateBridge } from './window-state.ts'
import { resolveDesktopInstance } from './desktop-instance.ts'

const require = createRequire(import.meta.url)
const STARTUP_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const desktopInstance = resolveDesktopInstance(process.env, app.getPath('appData'))
const APP_NAME = desktopInstance.applicationName

let mainWindow: BrowserWindow | undefined
let host: DesktopHost | undefined
let shutdownStarted = false
let browserViews: BrowserSurfaceDriver | undefined
let browserRpc: BrowserRpcServer | undefined
let windowState: WindowStateBridge | undefined
let titleBarTheme: TitleBarThemeBridge | undefined

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
  browserViews = new BrowserSurfaceDriver(window)
  await browserViews.install()
  browserRpc?.attach(browserViews)
  windowState = new WindowStateBridge(window)
  windowState.install()
  titleBarTheme = new TitleBarThemeBridge(window)
  titleBarTheme.install()
  window.webContents.on('page-title-updated', (event, title) => {
    event.preventDefault()
    window.setTitle(title.replace(/DeepSeek Harness$/, APP_NAME))
  })
  window.once('ready-to-show', () => { window.show() })
  window.on('closed', () => {
    windowState?.dispose()
    windowState = undefined
    titleBarTheme?.dispose()
    titleBarTheme = undefined
    browserViews?.dispose()
    browserViews = undefined
    if (mainWindow === window) mainWindow = undefined
  })
  await window.loadURL(activeHost.url.href)
  return window
}

/** Start the Host child and native window as one application lifecycle. */
async function start(): Promise<void> {
  const activeBrowserRpc = new BrowserRpcServer()
  await activeBrowserRpc.start()
  browserRpc = activeBrowserRpc
  const launch = resolveDesktopDshLaunch(
    require.resolve('@deepseek-ai/dsh/package.json'),
    process.env,
  )
  let systemProxyEnv: NodeJS.ProcessEnv = {}
  try {
    systemProxyEnv = await resolveSystemProxyEnvironment(
      process.env,
      url => session.defaultSession.resolveProxy(url),
    )
  } catch (error) {
    console.warn(`[deepcreator] Could not resolve the operating system proxy: ${error instanceof Error ? error.message : String(error)}`)
  }
  let activeHost: DesktopHost
  try {
    activeHost = await startDesktopHost({
      command: launch.command,
      args: launch.args,
      cwd: resolveDesktopWorkspace(process.env, process.cwd()),
      env: { ...launch.env, ...systemProxyEnv, ...activeBrowserRpc.hostEnv() },
      startupTimeoutMs: STARTUP_TIMEOUT_MS,
      shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
      onStdout: (line) => { console.log(`[dsh-host] ${line}`) },
      onStderr: (chunk) => { process.stderr.write(`[dsh-host] ${chunk}`) },
    })
  } catch (error) {
    await activeBrowserRpc.stop()
    if (browserRpc === activeBrowserRpc) browserRpc = undefined
    throw error
  }
  host = activeHost
  try {
    mainWindow = await createWindow(activeHost)
  } catch (error) {
    await activeHost.stop()
    await activeBrowserRpc.stop()
    if (browserRpc === activeBrowserRpc) browserRpc = undefined
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
// that also used the public DeepCreator product name. A named instance gets
// its own Chromium state and single-instance lock in addition to the separate
// official runtime data roots validated above.
app.setPath('userData', desktopInstance.userDataPath)

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
    if ((host === undefined && browserRpc === undefined) || shutdownStarted) return
    event.preventDefault()
    shutdownStarted = true
    const stoppingHost = host?.stop() ?? Promise.resolve()
    const stoppingBrowser = browserRpc?.stop() ?? Promise.resolve()
    void Promise.allSettled([stoppingHost, stoppingBrowser]).finally(() => {
      host = undefined
      browserRpc = undefined
      app.quit()
    })
  })

  // Complete ESM evaluation before Electron dispatches application readiness.
  void app.whenReady().then(start).catch((error: unknown) => {
    dialog.showErrorBox('DeepCreator 无法启动', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })
}
