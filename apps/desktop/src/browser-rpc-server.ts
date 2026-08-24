import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import type { IabRpcNotification, IabRpcRequest, IabRpcResponse } from '@ryanyujazz/dsh-browser-iab'
import type { BrowserSurfaceDriver } from './browser-views.ts'

export interface BrowserRpcEndpointAllocation {
  endpoint: string
  directory?: string
}

/**
 * Allocate the private Browser RPC endpoint.
 *
 * macOS limits a Unix-domain socket pathname to roughly 104 bytes. Electron's
 * temp directory can already consume most of that budget, so Unix endpoints
 * deliberately live in a short, owner-only directory below /tmp.
 */
export async function allocateBrowserRpcEndpoint(
  platform: NodeJS.Platform = process.platform,
): Promise<BrowserRpcEndpointAllocation> {
  if (platform === 'win32') {
    return { endpoint: `\\\\.\\pipe\\deepcreator-browser-${process.pid}-${randomUUID()}` }
  }
  const directory = await mkdtemp(join('/tmp', 'dcb-'))
  await chmod(directory, 0o700)
  return { endpoint: join(directory, 'rpc.sock'), directory }
}

export class BrowserRpcServer {
  endpoint: string | undefined
  readonly token = randomBytes(32).toString('hex')
  readonly #sockets = new Set<Socket>()
  #server: Server | undefined
  #driver: BrowserSurfaceDriver | undefined
  #endpointDirectory: string | undefined

  attach(driver: BrowserSurfaceDriver): void { this.#driver = driver; driver.setNotificationSink(notification => this.notify(notification)) }

  async start(): Promise<void> {
    if (this.#server !== undefined) return
    const allocation = await allocateBrowserRpcEndpoint()
    const server = createServer(socket => this.#accept(socket))
    this.endpoint = allocation.endpoint
    this.#endpointDirectory = allocation.directory
    try {
      await new Promise<void>((resolve, reject) => {
        const onListening = (): void => { server.off('error', onError); resolve() }
        const onError = (error: Error): void => { server.off('listening', onListening); reject(error) }
        server.once('listening', onListening)
        server.once('error', onError)
        server.listen(allocation.endpoint)
      })
      if (process.platform !== 'win32') await chmod(allocation.endpoint, 0o600)
      this.#server = server
    } catch (error) {
      if (server.listening) {
        await new Promise<void>(resolve => server.close(() => resolve()))
      }
      await this.#removeEndpoint()
      throw error
    }
  }

  hostEnv(): NodeJS.ProcessEnv {
    if (this.endpoint === undefined) throw new Error('Browser RPC server has not started.')
    return { DEEP_CREATOR_BROWSER_RPC_ENDPOINT: this.endpoint, DEEP_CREATOR_BROWSER_RPC_TOKEN: this.token }
  }

  notify(notification: IabRpcNotification): void {
    const line = `${JSON.stringify(notification)}\n`
    for (const socket of this.#sockets) if (!socket.destroyed) socket.write(line)
  }

  async stop(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy()
    this.#sockets.clear()
    const server = this.#server
    this.#server = undefined
    if (server !== undefined) await new Promise<void>(resolve => server.close(() => resolve()))
    await this.#removeEndpoint()
  }

  async #removeEndpoint(): Promise<void> {
    const endpoint = this.endpoint
    const directory = this.#endpointDirectory
    this.endpoint = undefined
    this.#endpointDirectory = undefined
    if (process.platform === 'win32') return
    if (directory !== undefined) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      return
    }
    if (endpoint !== undefined) await rm(endpoint, { force: true }).catch(() => undefined)
  }

  #accept(socket: Socket): void {
    this.#sockets.add(socket)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', chunk => {
      buffer += String(chunk)
      if (buffer.length > 2_000_000) { socket.destroy(); return }
      for (;;) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) break
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (line === '') continue
        void this.#handle(socket, line)
      }
    })
    socket.on('close', () => this.#sockets.delete(socket))
    socket.on('error', () => this.#sockets.delete(socket))
  }

  async #handle(socket: Socket, line: string): Promise<void> {
    let request: IabRpcRequest
    try { request = JSON.parse(line) as IabRpcRequest }
    catch { socket.destroy(); return }
    if (!this.#authenticated(request.token)) { socket.destroy(); return }
    let response: IabRpcResponse
    try {
      if (this.#driver === undefined) throw new Error('Built-in Browser window is not ready.')
      const result = await this.#driver.dispatch(request.method, request.params)
      response = { id: request.id, ok: true, result }
    } catch (error) {
      const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
      response = { id: request.id, ok: false, error: { code: typeof candidate.code === 'string' ? candidate.code as never : 'BROWSER_UNAVAILABLE', message: typeof candidate.message === 'string' ? candidate.message : String(error), ...(candidate.details !== null && typeof candidate.details === 'object' ? { details: candidate.details as Record<string, unknown> } : {}) } }
    }
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`)
  }

  #authenticated(candidate: string): boolean {
    const left = Buffer.from(candidate ?? '')
    const right = Buffer.from(this.token)
    return left.length === right.length && timingSafeEqual(left, right)
  }
}
