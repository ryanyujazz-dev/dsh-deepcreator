import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer as createHttpServer, request as requestHttp, type IncomingHttpHeaders, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { Duplex } from 'node:stream'
import { Bonjour, type Service as BonjourService } from 'bonjour-service'
import QRCode from 'qrcode'
import type { RemoteAccessDomain } from './storage.ts'
import { PAIRING_TICKET_TTL_MS, REMOTE_DEVICE_MAX_IDLE_MS, type RemoteCapabilities, type RemoteDeviceRecord, type RemotePairingRequest, type RemotePairingTicket } from './types.ts'

const AUTH_COOKIE = 'deepcreator_remote'
const AUTH_COOKIE_MAX_AGE_SECONDS = REMOTE_DEVICE_MAX_IDLE_MS / 1000
const INNER_AUTHORITY = 'deepcreator-remote.local:43127'
const REMOTE_BOOTSTRAP_PATH = '/deepcreator/remote/bootstrap.js'
const REMOTE_BOOTSTRAP_TAG = `<script src="${REMOTE_BOOTSTRAP_PATH}" data-deepcreator-remote-bootstrap></script>`
export const REMOTE_BOOTSTRAP_SCRIPT = `(()=>{const c=globalThis.crypto;if(!c||typeof c.randomUUID==='function'||typeof c.getRandomValues!=='function')return;const h=[];for(let i=0;i<256;i++)h.push(i.toString(16).padStart(2,'0'));Object.defineProperty(c,'randomUUID',{configurable:true,value:()=>{const b=c.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return h[b[0]]+h[b[1]]+h[b[2]]+h[b[3]]+'-'+h[b[4]]+h[b[5]]+'-'+h[b[6]]+h[b[7]]+'-'+h[b[8]]+h[b[9]]+'-'+h[b[10]]+h[b[11]]+h[b[12]]+h[b[13]]+h[b[14]]+h[b[15]]}})})();`
const ALLOWED_API = new Set([
  'host.describe',
  // Read-only command metadata powers the existing composer's `/` detector
  // and leading `+` launcher. Command execution still travels through the
  // separately admitted Session data plane; no command-admin API is exposed.
  'commands/list',
  'session.list', 'session.search', 'session.create', 'session.history', 'session.models', 'session.selectModel',
  'session.rename', 'session.fork', 'session.prompt', 'session.attachment', 'session.updateQueue', 'session.cancel',
  'subagent.list', 'subagent.history', 'subagent.prompt', 'subagent.interrupt',
  'workspace.list', 'workspace.archiveSession',
  'agentPreset.list', 'agentPreset.select',
  'goal.create', 'goal.edit', 'goal.pause', 'goal.resume', 'goal.complete', 'goal.clear',
  'settings.describe',
  'llm.providers', 'llm.models', 'respond',
  'artifacts/read',
  'review/history', 'review/status', 'review/summary', 'review/diff', 'review/manifest', 'review/probe',
  'review/patches', 'review/source', 'review/checks',
  'jobs-admin/stop', 'jobs-admin/subagentOverview',
  'presentation/pending', 'presentation/waitRevision', 'presentation/claim', 'presentation/acknowledge',
  'presentation/dismiss', 'presentation/open',
])

interface PendingRequest extends RemotePairingRequest {
  ticket: string
  approved?: { deviceId: string; token: string; deviceName: string }
  rejected?: true
}

interface TicketState {
  token: string
  expiresAt: number
  expiry: NodeJS.Timeout
  requestId?: string
}

export interface GatewayStatus {
  port: number
  addresses: string[]
  hostName: string
}

export interface LanGatewayOptions {
  port: number
  innerPort: number
  hostId: string
  domain: RemoteAccessDomain
  onDeviceSeen(device: RemoteDeviceRecord): void
}

function json(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

function text(response: ServerResponse, status: number, value: string, contentType = 'text/plain; charset=utf-8'): void {
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  response.end(value)
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const item of header?.split(';') ?? []) {
    const at = item.indexOf('=')
    if (at < 1) continue
    out[item.slice(0, at).trim()] = decodeURIComponent(item.slice(at + 1).trim())
  }
  return out
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.byteLength === b.byteLength && timingSafeEqual(a, b)
}

export function lanAddresses(): string[] {
  const result = new Set<string>()
  for (const rows of Object.values(networkInterfaces())) {
    for (const row of rows ?? []) {
      if (row.family === 'IPv4' && !row.internal && !row.address.startsWith('169.254.')) result.add(row.address)
    }
  }
  return [...result]
}

export function isRemoteApiAllowed(pathname: string): boolean {
  if (pathname === '/api/events.mux' || pathname === '/api/events.host') return true
  if (!pathname.startsWith('/api/')) return false
  return ALLOWED_API.has(pathname.slice('/api/'.length))
}

export function isAllowedLanHost(authority: string | undefined, hostName: string, addresses: readonly string[], port: number): boolean {
  if (authority === undefined) return false
  try {
    const url = new URL(`http://${authority}`)
    const expectedPort = port === 80 ? '' : String(port)
    return url.port === expectedPort && (url.hostname.toLowerCase() === hostName.toLowerCase() || addresses.includes(url.hostname))
  } catch {
    return false
  }
}

export function pairingPage(hostName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>DeepCreator</title><style>body{font:16px/1.5 system-ui;margin:0;background:#f6f7f9;color:#202124}.card{max-width:520px;margin:10vh auto;padding:24px;background:white;border-radius:20px;box-shadow:0 8px 32px #0002}button{font:inherit;padding:12px 16px;border:0;border-radius:12px;background:#2867e8;color:white}code{font-size:24px}.warning{padding:10px 12px;border-radius:10px;background:#fff4d6;color:#694b00}small{color:#667}</style></head><body><main class="card"><h1>连接 DeepCreator</h1><p class="warning">此连接未加密，请仅在你信任的 Wi‑Fi 中使用。</p><p id="state">正在创建配对请求…</p><p><code id="code"></code></p><p><small>请在 ${escapeHtml(hostName)} 的“设置 → 远程”中核对验证码并批准此设备。</small></p></main><script>
const token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const state=document.querySelector('#state'),code=document.querySelector('#code');
async function run(){if(!token){state.textContent='配对链接无效。';return}const options={method:'POST',headers:{'content-type':'application/json'}};const created=await fetch('/deepcreator/remote/pair/request',{...options,body:JSON.stringify({ticket:token,deviceName:navigator.platform||'Mobile browser'})});if(!created.ok){state.textContent='配对链接已失效，请在桌面端重新生成。';return}const request=await created.json();code.textContent=request.code;state.textContent='等待桌面端确认';for(;;){await new Promise(r=>setTimeout(r,1000));const response=await fetch('/deepcreator/remote/pair/status',{...options,body:JSON.stringify({requestId:request.requestId,ticket:token})});if(response.status===202)continue;if(response.ok){state.textContent='连接成功，正在打开…';location.replace('/');return}state.textContent='配对被拒绝或已失效。';return}}
run().catch(()=>{state.textContent='无法连接桌面端。'});
</script></body></html>`
}

export function authCookie(value: string, maxAge = AUTH_COOKIE_MAX_AGE_SECONDS): string {
  return `${AUTH_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
}

export function remoteProxyHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const next: IncomingHttpHeaders = {
    ...headers,
    'x-forwarded-proto': 'http',
    host: INNER_AUTHORITY,
    origin: `http://${INNER_AUTHORITY}`,
  }
  if (headers.host === undefined) delete next['x-forwarded-host']
  else next['x-forwarded-host'] = headers.host
  if (headers.origin === undefined) delete next['x-forwarded-origin']
  else next['x-forwarded-origin'] = headers.origin
  delete next['content-length']
  return next
}

export function injectRemoteBootstrap(html: string): string {
  if (html.includes('data-deepcreator-remote-bootstrap')) return html
  const head = /<head(?:\s[^>]*)?>/i.exec(html)
  if (head === null) return `${REMOTE_BOOTSTRAP_TAG}${html}`
  const at = (head.index ?? 0) + head[0].length
  return `${html.slice(0, at)}${REMOTE_BOOTSTRAP_TAG}${html.slice(at)}`
}

export class LanGateway {
  private readonly options: LanGatewayOptions
  private readonly addresses: string[]
  private readonly hostName: string
  private readonly pending = new Map<string, PendingRequest>()
  private readonly lastSeenWrites = new Map<string, number>()
  private server: HttpServer | undefined
  private ticket: TicketState | undefined
  private bonjour: Bonjour | undefined
  private advertisement: BonjourService | undefined

  constructor(options: LanGatewayOptions) {
    this.options = options
    this.addresses = lanAddresses()
    this.hostName = `deepcreator-${options.hostId.slice(0, 8)}.local`
  }

  async start(): Promise<GatewayStatus> {
    if (this.addresses.length === 0) throw new Error('No routable IPv4 LAN address is available.')
    try {
      this.server = createHttpServer((request, response) => {
        void this.handle(request, response).catch(error => {
          if (!response.headersSent) text(response, 500, error instanceof Error ? error.message : String(error))
          else response.destroy()
        })
      })
      this.server.on('upgrade', (request, socket, head) => { void this.upgrade(request, socket, head) })
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(this.options.port, '0.0.0.0', () => { this.server!.off('error', reject); resolve() })
      })
      this.server.unref()
      this.bonjour = new Bonjour()
      this.advertisement = this.bonjour.publish({ name: `DeepCreator ${this.options.hostId.slice(0, 6)}`, type: 'http', port: this.options.port, host: this.hostName, txt: { product: 'deepcreator', version: '1', security: 'trusted-lan' } })
      return {
        port: this.options.port,
        addresses: [
          `http://${this.hostName}:${this.options.port}`,
          ...this.addresses.map(address => `http://${address}:${this.options.port}`),
        ],
        hostName: this.hostName,
      }
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async close(): Promise<void> {
    await this.closeTicket()
    this.pending.clear()
    this.advertisement?.stop()
    this.bonjour?.destroy()
    this.advertisement = undefined
    this.bonjour = undefined
    const server = this.server
    this.server = undefined
    if (server !== undefined) {
      server.closeAllConnections()
      if (server.listening) await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  }

  listPending(): RemotePairingRequest[] {
    this.prune()
    return [...this.pending.values()].filter(item => item.approved === undefined && item.rejected !== true).map(({ requestId, deviceName, code, createdAt, expiresAt }) => ({ requestId, deviceName, code, createdAt, expiresAt }))
  }

  async createTicket(): Promise<RemotePairingTicket> {
    await this.closeTicket()
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + PAIRING_TICKET_TTL_MS
    const setupUrl = `http://${this.addresses[0]}:${this.options.port}/deepcreator/remote/pair#${token}`
    const expiry = setTimeout(() => { if (this.ticket?.token === token) void this.closeTicket() }, PAIRING_TICKET_TTL_MS)
    expiry.unref()
    this.ticket = { token, expiresAt, expiry }
    return { setupUrl, qrDataUrl: await QRCode.toDataURL(setupUrl, { margin: 1, width: 320 }), expiresAt }
  }

  async approve(requestId: string): Promise<boolean> {
    this.prune()
    const request = this.pending.get(requestId)
    if (request === undefined || request.rejected === true || request.approved !== undefined) return false
    const token = randomBytes(32).toString('base64url')
    const deviceId = randomUUID()
    const now = Date.now()
    const record: RemoteDeviceRecord = { id: deviceId, name: request.deviceName, firstConnectedAt: now, lastConnectedAt: now, tokenHash: tokenHash(token) }
    await this.options.domain.table('devices').put(deviceId, record)
    request.approved = { deviceId, token, deviceName: request.deviceName }
    return true
  }

  reject(requestId: string): boolean {
    const request = this.pending.get(requestId)
    if (request === undefined || request.approved !== undefined) return false
    request.rejected = true
    return true
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? this.hostName}`)
    if (!isAllowedLanHost(request.headers.host, this.hostName, this.addresses, this.options.port) || !this.sameOrigin(request)) { text(response, 403, 'Forbidden.'); return }
    if (url.pathname === '/deepcreator/remote/pair' && request.method === 'GET') { text(response, 200, pairingPage(this.hostName), 'text/html; charset=utf-8'); return }
    if (url.pathname === '/deepcreator/remote/pair/request' && request.method === 'POST') { await this.requestPairing(request, response); return }
    if (url.pathname === '/deepcreator/remote/pair/status' && request.method === 'POST') { await this.pairingStatus(request, response); return }
    const device = await this.authenticate(request)
    if (device === undefined) { text(response, 401, 'Pair this browser from DeepCreator Settings.'); return }
    const credential = parseCookies(request.headers.cookie)[AUTH_COOKIE]
    if (credential !== undefined) response.setHeader('set-cookie', authCookie(credential))
    if (url.pathname === '/deepcreator/remote/capabilities') {
      const capabilities: RemoteCapabilities = { remote: true, deviceId: device.id, deviceName: device.name, hostName: this.hostName, transport: 'http', allowedFeatures: ['sessions', 'messages', 'approvals', 'questions', 'artifacts', 'review', 'activity'] }
      json(response, 200, capabilities)
      return
    }
    if (url.pathname === '/deepcreator/remote/disconnect' && request.method === 'POST') {
      json(response, 200, { disconnected: true }, { 'set-cookie': authCookie('', 0) })
      return
    }
    if (url.pathname === REMOTE_BOOTSTRAP_PATH && request.method === 'GET') {
      text(response, 200, REMOTE_BOOTSTRAP_SCRIPT, 'text/javascript; charset=utf-8')
      return
    }
    if (url.pathname.startsWith('/api/') && !isRemoteApiAllowed(url.pathname)) { text(response, 403, 'Remote capability denied.'); return }
    await this.proxy(request, response)
  }

  private sameOrigin(request: IncomingMessage): boolean {
    if (request.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = request.headers.origin
    if (origin === undefined) return true
    try { return new URL(origin).host === request.headers.host }
    catch { return false }
  }

  private async requestPairing(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await this.readJson(request)
    const ticket = typeof body.ticket === 'string' ? body.ticket : ''
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 80) : ''
    if (this.ticket === undefined || this.ticket.expiresAt < Date.now() || ticket !== this.ticket.token || deviceName === '') { text(response, 410, 'Pairing ticket expired.'); return }
    if (this.ticket.requestId !== undefined) {
      const existing = this.pending.get(this.ticket.requestId)
      if (existing === undefined || existing.rejected === true) { text(response, 410, 'Pairing ticket already used.'); return }
      json(response, 200, { requestId: existing.requestId, code: existing.code, expiresAt: existing.expiresAt })
      return
    }
    const item: PendingRequest = { requestId: randomUUID(), ticket, deviceName, code: String(randomInt(100_000, 1_000_000)), createdAt: Date.now(), expiresAt: this.ticket.expiresAt }
    this.pending.set(item.requestId, item)
    this.ticket.requestId = item.requestId
    json(response, 200, { requestId: item.requestId, code: item.code, expiresAt: item.expiresAt })
  }

  private async pairingStatus(incoming: IncomingMessage, response: ServerResponse): Promise<void> {
    this.prune()
    const body = await this.readJson(incoming)
    const request = this.pending.get(typeof body.requestId === 'string' ? body.requestId : '')
    const ticket = typeof body.ticket === 'string' ? body.ticket : ''
    if (request === undefined || request.ticket !== ticket || request.expiresAt < Date.now() || request.rejected === true) { text(response, 410, 'Pairing request expired.'); return }
    if (request.approved === undefined) { json(response, 202, { pending: true }); return }
    const cookie = authCookie(`${request.approved.deviceId}.${request.approved.token}`)
    json(response, 200, { paired: true }, { 'set-cookie': cookie })
    this.pending.delete(request.requestId)
    await this.closeTicket()
  }

  private async authenticate(request: IncomingMessage): Promise<RemoteDeviceRecord | undefined> {
    const value = parseCookies(request.headers.cookie)[AUTH_COOKIE]
    if (value === undefined) return
    const at = value.indexOf('.')
    if (at <= 0) return
    const id = value.slice(0, at)
    const token = value.slice(at + 1)
    const record = this.options.domain.table('devices').get(id)
    if (record === undefined || !sameHash(record.tokenHash, tokenHash(token))) return
    const now = Date.now()
    if (now - record.lastConnectedAt > REMOTE_DEVICE_MAX_IDLE_MS) {
      void this.options.domain.table('devices').delete(id)
      return
    }
    if (now - (this.lastSeenWrites.get(id) ?? record.lastConnectedAt) > 60_000) {
      this.lastSeenWrites.set(id, now)
      const next = { ...record, lastConnectedAt: now }
      void this.options.domain.table('devices').put(id, next).then(() => { this.options.onDeviceSeen(next) })
    }
    return record
  }

  private async proxy(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const headers = this.innerHeaders(request.headers)
    const injectBootstrap = request.method === 'GET' && new URL(request.url ?? '/', 'http://remote.local').pathname === '/'
    if (injectBootstrap) delete headers['accept-encoding']
    await new Promise<void>((resolve, reject) => {
      const upstream = requestHttp({ host: '127.0.0.1', port: this.options.innerPort, method: request.method, path: request.url, headers }, proxied => {
        const out = { ...proxied.headers }
        delete out['set-cookie']
        if (injectBootstrap && String(proxied.headers['content-type'] ?? '').toLowerCase().includes('text/html')) {
          delete out['content-length']
          delete out['content-encoding']
          const chunks: Buffer[] = []
          proxied.on('data', chunk => { chunks.push(Buffer.from(chunk)) })
          proxied.once('error', reject)
          proxied.once('end', () => {
            response.writeHead(proxied.statusCode ?? 502, out)
            response.end(injectRemoteBootstrap(Buffer.concat(chunks).toString('utf8')))
            resolve()
          })
          return
        }
        response.writeHead(proxied.statusCode ?? 502, out)
        proxied.pipe(response)
        proxied.once('end', resolve)
        proxied.once('error', reject)
      })
      upstream.once('error', reject)
      request.pipe(upstream)
    })
  }

  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    socket.on('error', () => {})
    const pathname = new URL(request.url ?? '/', 'http://remote.local').pathname
    if (!isAllowedLanHost(request.headers.host, this.hostName, this.addresses, this.options.port) || !this.sameOrigin(request) || !isRemoteApiAllowed(pathname) || await this.authenticate(request) === undefined) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return }
    const upstream = requestHttp({ host: '127.0.0.1', port: this.options.innerPort, method: request.method, path: request.url, headers: this.innerHeaders(request.headers) })
    upstream.on('upgrade', (proxied, upstreamSocket, upstreamHead) => {
      const closeUpstream = (): void => { if (!upstreamSocket.destroyed) upstreamSocket.destroy() }
      upstreamSocket.on('error', () => { if (!socket.destroyed) socket.destroy() })
      socket.once('close', closeUpstream)
      if (socket.destroyed || !socket.writable) { closeUpstream(); return }
      const headerLines = Object.entries(proxied.headers).flatMap(([key, value]) => value === undefined ? [] : [`${key}: ${Array.isArray(value) ? value.join(', ') : value}`])
      socket.write(`HTTP/1.1 ${proxied.statusCode ?? 101} ${proxied.statusMessage ?? 'Switching Protocols'}\r\n${headerLines.join('\r\n')}\r\n\r\n`)
      if (upstreamHead.byteLength > 0) socket.write(upstreamHead)
      if (head.byteLength > 0) upstreamSocket.write(head)
      upstreamSocket.pipe(socket).pipe(upstreamSocket)
    })
    upstream.once('response', proxied => {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${proxied.statusCode ?? 502} ${proxied.statusMessage ?? 'Bad Gateway'}\r\nConnection: close\r\n\r\n`)
    })
    upstream.once('error', () => { if (!socket.destroyed) socket.destroy() })
    upstream.end()
  }

  private innerHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    return remoteProxyHeaders(headers)
  }

  private async readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk)
      size += buffer.byteLength
      if (size > 16_384) throw new Error('Pairing request is too large.')
      chunks.push(buffer)
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, request] of this.pending) if (request.expiresAt < now) this.pending.delete(id)
  }

  private async closeTicket(): Promise<void> {
    const ticket = this.ticket
    this.ticket = undefined
    if (ticket === undefined) return
    clearTimeout(ticket.expiry)
    const approvedDeviceIds: string[] = []
    for (const [requestId, request] of this.pending) {
      if (request.ticket !== ticket.token) continue
      this.pending.delete(requestId)
      if (request.approved !== undefined) approvedDeviceIds.push(request.approved.deviceId)
    }
    if (approvedDeviceIds.length > 0) {
      const devices = this.options.domain.table('devices')
      await Promise.all(approvedDeviceIds.map(deviceId => devices.delete(deviceId)))
    }
  }
}
