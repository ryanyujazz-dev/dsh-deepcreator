import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { BrowserRuntimeError, type BrowserSignal } from '@ryanyujazz/dsh-browser'
import type { ChromeBridgeNotification, ChromeBridgeRequest, ChromeBridgeResponse } from './protocol.ts'
import type { ChromeNetworkDecision } from './protocol.ts'

interface Pending { resolve(value: unknown): void; reject(error: unknown): void; timer: NodeJS.Timeout }
interface Hello { kind: 'hello'; token: string }

function dshRoot(): string { return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh')) }
export function chromeRendezvousPath(): string { return join(dshRoot(), 'browser', 'chrome', 'rendezvous.json') }

export class ChromeBridgeServer {
  readonly token = randomBytes(32).toString('hex')
  readonly #pending = new Map<string, Pending>()
  readonly #listeners = new Set<(event: ChromeBridgeNotification) => void>()
  readonly #connectionListeners = new Set<(connected: boolean) => void>()
  #server: Server | undefined
  #socket: Socket | undefined
  #directory: string | undefined

  get connected(): boolean { return this.#socket !== undefined && !this.#socket.destroyed }
  onNotification(listener: (event: ChromeBridgeNotification) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  onConnection(listener: (connected: boolean) => void): () => void { this.#connectionListeners.add(listener); return () => this.#connectionListeners.delete(listener) }
  send(message: ChromeNetworkDecision): void { if (this.#socket !== undefined && !this.#socket.destroyed) this.#socket.write(`${JSON.stringify(message)}\n`) }

  async start(): Promise<void> {
    if (this.#server !== undefined) return
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\deepcreator-chrome-${process.pid}-${randomUUID()}` : await this.#unixEndpoint()
    const server = createServer(socket => this.#accept(socket))
    await new Promise<void>((resolveListen, reject) => { server.once('listening', resolveListen); server.once('error', reject); server.listen(endpoint) })
    if (process.platform !== 'win32') await chmod(endpoint, 0o600)
    this.#server = server
    const rendezvous = chromeRendezvousPath(); await mkdir(dirname(rendezvous), { recursive: true, mode: 0o700 })
    await writeFile(rendezvous, JSON.stringify({ endpoint, token: this.token }), { mode: 0o600 })
  }

  async call<T>(method: string, params: unknown, signal: BrowserSignal): Promise<T> {
    const socket = this.#socket
    if (socket === undefined || socket.destroyed) throw new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Chrome extension is not connected. Share or create a tab from the DeepCreator Chrome extension, then retry.')
    if (signal.aborted) throw new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Chrome command cancelled.')
    const id = randomUUID(); const request: ChromeBridgeRequest = { id, method, params }
    return new Promise<T>((resolveCall, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new BrowserRuntimeError('TIMEOUT', `Chrome extension ${method} timed out.`)) }, 30_000); timer.unref?.()
      const abort = () => { clearTimeout(timer); this.#pending.delete(id); reject(new BrowserRuntimeError('CONTROL_INTERRUPTED', 'Chrome command cancelled.')) }
      const unsubscribe = signal.subscribe(abort)
      this.#pending.set(id, { timer, resolve(value) { unsubscribe(); resolveCall(value as T) }, reject(error) { unsubscribe(); reject(error) } })
      socket.write(`${JSON.stringify(request)}\n`)
    })
  }

  async dispose(): Promise<void> {
    this.#socket?.destroy(); this.#socket = undefined
    this.#failPending(new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Chrome bridge stopped.'))
    const server = this.#server; this.#server = undefined
    if (server !== undefined) await new Promise<void>(done => server.close(() => done()))
    await rm(chromeRendezvousPath(), { force: true }).catch(() => undefined)
    if (this.#directory !== undefined) await rm(this.#directory, { recursive: true, force: true }).catch(() => undefined)
  }

  async #unixEndpoint(): Promise<string> { const directory = await mkdtemp(join(tmpdir().length < 40 ? tmpdir() : '/tmp', 'dcc-')); await chmod(directory, 0o700); this.#directory = directory; return join(directory, 'rpc.sock') }
  #accept(socket: Socket): void {
    let authenticated = false; let buffer = ''; socket.setEncoding('utf8')
    socket.on('data', chunk => {
      buffer += String(chunk); if (buffer.length > 4_000_000) { socket.destroy(); return }
      for (;;) { const newline = buffer.indexOf('\n'); if (newline < 0) break; const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line === '') continue
        let message: Hello | ChromeBridgeResponse | ChromeBridgeNotification
        try { message = JSON.parse(line) as typeof message } catch { socket.destroy(); return }
        if (!authenticated) { if (!('kind' in message) || message.kind !== 'hello' || !this.#authenticated(message.token)) { socket.destroy(); return }; authenticated = true; this.#socket?.destroy(); this.#socket = socket; for (const listener of this.#connectionListeners) listener(true); continue }
        if ('event' in message) { for (const listener of this.#listeners) listener(message); continue }
        if (!('id' in message)) continue
        const pending = this.#pending.get(message.id); if (pending === undefined) continue; this.#pending.delete(message.id); clearTimeout(pending.timer)
        if (message.ok) pending.resolve(message.result); else pending.reject(new BrowserRuntimeError(message.error?.code ?? 'BROWSER_UNAVAILABLE', message.error?.message ?? 'Chrome extension command failed.', message.error?.details === undefined ? undefined : { ...message.error.details }))
      }
    })
    socket.on('close', () => { if (this.#socket !== socket) return; this.#socket = undefined; this.#failPending(new BrowserRuntimeError('PROVIDER_UNAVAILABLE', 'Chrome extension disconnected.')); for (const listener of this.#connectionListeners) listener(false) })
  }
  #authenticated(value: string): boolean { const left = Buffer.from(value ?? ''); const right = Buffer.from(this.token); return left.length === right.length && timingSafeEqual(left, right) }
  #failPending(error: unknown): void { for (const item of this.#pending.values()) { clearTimeout(item.timer); item.reject(error) }; this.#pending.clear() }
}
