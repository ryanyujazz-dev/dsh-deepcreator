/**
 * Lifecycle owner for the temporary Desktop-to-Web carrier. The Electron
 * process starts the `deepcreator` profile and treats its loopback URL line
 * as readiness; the child remains the sole owner of the Cordis tree.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

/** One terminated child-process result. */
interface DesktopHostExit {
  /** Numeric exit status, or null when a signal ended the process. */
  code: number | null
  /** Terminating signal, or null after an ordinary exit. */
  signal: NodeJS.Signals | null
}

/** Inputs required to start and bound the desktop Host child. */
export interface DesktopHostOptions {
  /** Executable used to start the Host. */
  command: string
  /** Complete argument list for the executable. */
  args: readonly string[]
  /** Working directory inherited by workspace-sensitive Host services. */
  cwd: string
  /** Environment visible to the child. */
  env: NodeJS.ProcessEnv
  /** Maximum time allowed before the readiness URL is printed. */
  startupTimeoutMs: number
  /** Grace period between SIGTERM and SIGKILL. */
  shutdownTimeoutMs: number
  /** Receives complete stdout lines, including the readiness line. */
  onStdout: (line: string) => void
  /** Receives stderr chunks without changing their bytes. */
  onStderr: (chunk: string) => void
}

/** A ready Host child owned by the Electron application. */
export interface DesktopHost {
  /** Trusted loopback origin printed after the Cordis tree settles. */
  url: URL
  /** Settles after all child stdio handles close. */
  exited: Promise<DesktopHostExit>
  /** Request graceful shutdown, escalate after the configured bound, and await exit. */
  stop(): Promise<void>
}

const READY_PREFIX = 'dsh web: '

/**
 * Parse the Web surface's readiness line and reject every non-loopback origin.
 * @param line - one complete stdout line.
 * @returns the trusted URL, or undefined when the line is not valid readiness.
 */
export function parseDesktopHostUrl(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const candidate = line.slice(READY_PREFIX.length).split(' ', 1)[0]
  if (candidate === undefined) return undefined
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === ''
    || url.username !== '' || url.password !== '' || url.pathname !== '/') return undefined
  return url
}

/** Wait for a promise until the supplied timeout and report whether it settled. */
async function waitBounded(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => { resolve(false) }, timeoutMs)
  })
  const settled = await Promise.race([promise.then(() => true), timedOut])
  if (timer !== undefined) clearTimeout(timer)
  return settled
}

/** Terminate one owned child and wait until its stdio handles close. */
async function terminate(
  child: ChildProcess,
  exited: Promise<DesktopHostExit>,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exited
    return
  }
  child.kill('SIGTERM')
  if (await waitBounded(exited, timeoutMs)) return
  child.kill('SIGKILL')
  await exited
}

/**
 * Start a Web-profile Host and resolve only after its Loader-settled readiness
 * line names a trusted loopback origin. Startup failure owns child teardown.
 * @param options - executable, bounds, environment, and output sinks.
 * @returns the ready Host handle.
 */
export async function startDesktopHost(options: DesktopHostOptions): Promise<DesktopHost> {
  const child = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let spawnError: Error | undefined
  child.once('error', (error) => { spawnError = error })
  const exited = new Promise<DesktopHostExit>((resolve) => {
    child.once('close', (code, signal) => { resolve({ code, signal }) })
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { options.onStderr(chunk) })

  const lines = createInterface({ input: child.stdout })
  let resolveReady: ((url: URL) => void) | undefined
  const ready = new Promise<URL>((resolve) => { resolveReady = resolve })
  lines.on('line', (line) => {
    options.onStdout(line)
    const url = parseDesktopHostUrl(line)
    if (url !== undefined) resolveReady?.(url)
  })
  void exited.then(() => { lines.close() })

  let startupTimer: ReturnType<typeof setTimeout> | undefined
  const startupExpired = new Promise<never>((_resolve, reject) => {
    startupTimer = setTimeout(() => {
      reject(new Error(`dsh desktop: Host did not become ready within ${String(options.startupTimeoutMs)}ms`))
    }, options.startupTimeoutMs)
  })
  const exitedBeforeReady = exited.then(({ code, signal }) => {
    const cause = spawnError === undefined ? '' : `: ${spawnError.message}`
    throw new Error(`dsh desktop: Host exited before readiness (code ${String(code)}, signal ${String(signal)})${cause}`)
  })

  let url: URL
  try {
    url = await Promise.race([ready, startupExpired, exitedBeforeReady])
  } catch (error) {
    await terminate(child, exited, options.shutdownTimeoutMs)
    throw error
  } finally {
    if (startupTimer !== undefined) clearTimeout(startupTimer)
  }

  let stopping: Promise<void> | undefined
  return {
    url,
    exited,
    stop: () => {
      stopping ??= terminate(child, exited, options.shutdownTimeoutMs)
      return stopping
    },
  }
}
