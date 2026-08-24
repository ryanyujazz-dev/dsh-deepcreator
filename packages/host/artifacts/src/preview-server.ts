import { createServer, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { once } from 'node:events'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8', '.html': 'text/html; charset=utf-8', '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg', '.otf': 'font/otf', '.pdf': 'application/pdf', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm', '.wav': 'audio/wav', '.webm': 'video/webm', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
}

function fenced(root: string, target: string): boolean {
  const rel = relative(root, target)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function fail(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.end(message)
}

interface PreviewOrigin { server: Server; origin: string }

function requestedByteRange(value: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (value === undefined) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (match === null || size <= 0) return null
  const [, first = '', last = ''] = match
  if (first === '' && last === '') return null
  if (first === '') {
    const suffixLength = Number(last)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  const start = Number(first)
  const requestedEnd = last === '' ? size - 1 : Number(last)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

/**
 * Same-origin, unguessable single-file capabilities for image/PDF rendering.
 * Authentication remains the outer transport's concern; the random token
 * prevents an unrelated page on the same Host origin from enumerating files.
 */
export class ArtifactResourceRegistry {
  private readonly byToken = new Map<string, string>()
  private readonly byPath = new Map<string, string>()
  private readonly disposeRoute: () => void

  constructor(webServer: WebServer) {
    this.disposeRoute = webServer.register({
      kind: 'prefix',
      path: '/deepcreator-artifacts',
      handler: (request, response) => this.respond(
        request.method ?? 'GET',
        request.url ?? '/',
        typeof request.headers.range === 'string' ? request.headers.range : undefined,
        response,
      ),
    })
  }

  async urlFor(entryPath: string): Promise<string> {
    const target = await realpath(entryPath)
    let token = this.byPath.get(target)
    if (token === undefined) {
      token = randomBytes(24).toString('base64url')
      this.byPath.set(target, token)
      this.byToken.set(token, target)
    }
    return `/deepcreator-artifacts/${token}`
  }

  dispose(): void {
    this.byToken.clear()
    this.byPath.clear()
    this.disposeRoute()
  }

  private async respond(method: string, rawUrl: string, rangeHeader: string | undefined, response: ServerResponse): Promise<void> {
    response.setHeader('cache-control', 'private, no-store')
    response.setHeader('referrer-policy', 'no-referrer')
    response.setHeader('x-content-type-options', 'nosniff')
    if (method !== 'GET' && method !== 'HEAD') { fail(response, 405, 'Method not allowed.'); return }
    let token: string
    try {
      const pathname = decodeURIComponent(new URL(rawUrl, 'http://artifact.local').pathname)
      const parts = pathname.split('/').filter(Boolean)
      if (parts.length !== 2 || parts[0] !== 'deepcreator-artifacts') { fail(response, 404, 'Artifact resource not found.'); return }
      token = parts[1]!
    } catch { fail(response, 400, 'Invalid artifact resource path.'); return }
    const registered = this.byToken.get(token)
    if (registered === undefined) { fail(response, 404, 'Artifact resource not found.'); return }
    let target: string
    try {
      target = await realpath(registered)
      if (target !== registered || !(await stat(target)).isFile()) { fail(response, 404, 'Artifact resource not found.'); return }
    } catch { fail(response, 404, 'Artifact resource not found.'); return }
    const mime = MIME_TYPES[extname(target).toLowerCase()]
    if (mime === undefined || (!mime.startsWith('image/') && mime !== 'application/pdf')) {
      fail(response, 403, 'Artifact resource type is not remotely previewable.'); return
    }
    const content = await readFile(target)
    response.setHeader('content-type', mime)
    response.setHeader('accept-ranges', 'bytes')
    const range = requestedByteRange(rangeHeader, content.byteLength)
    if (range === null) {
      response.statusCode = 416
      response.setHeader('content-range', `bytes */${content.byteLength}`)
      response.setHeader('content-length', '0')
      response.end()
      return
    }
    const body = range === undefined ? content : content.subarray(range.start, range.end + 1)
    response.statusCode = range === undefined ? 200 : 206
    if (range !== undefined) response.setHeader('content-range', `bytes ${range.start}-${range.end}/${content.byteLength}`)
    response.setHeader('content-length', String(body.byteLength))
    if (method === 'HEAD') response.end()
    else response.end(body)
  }
}

/**
 * Lazily serves one HTML entry directory per loopback origin. A distinct
 * random OS port is the capability boundary, so root-relative web assets keep
 * normal browser semantics without exposing a workspace-wide static server.
 */
export class ArtifactPreviewRegistry {
  private readonly origins = new Map<string, Promise<PreviewOrigin>>()

  async urlFor(entryPath: string): Promise<string> {
    const root = await realpath(dirname(entryPath))
    let pending = this.origins.get(root)
    if (pending === undefined) {
      pending = this.start(root)
      this.origins.set(root, pending)
      void pending.catch(() => { if (this.origins.get(root) === pending) this.origins.delete(root) })
    }
    const { origin } = await pending
    return `${origin}/${encodeURIComponent(entryPath.slice(root.length + 1))}`
  }

  async dispose(): Promise<void> {
    const origins = await Promise.allSettled(this.origins.values())
    this.origins.clear()
    await Promise.all(origins.flatMap(result => result.status === 'fulfilled'
      ? [new Promise<void>(resolveClose => result.value.server.close(() => { resolveClose() }))]
      : []))
  }

  private async start(root: string): Promise<PreviewOrigin> {
    const server = createServer((request, response) => {
      void this.respond(root, request.method ?? 'GET', request.url ?? '/', response)
        .catch(() => { if (!response.headersSent) fail(response, 500, 'Artifact preview failed.'); else response.destroy() })
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    server.unref()
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('Artifact preview server did not bind a TCP port.')
    }
    return { server, origin: `http://127.0.0.1:${address.port}` }
  }

  private async respond(root: string, method: string, rawUrl: string, response: ServerResponse): Promise<void> {
    response.setHeader('cache-control', 'no-store')
    // Artifact instances run on the Host's app origin while this fenced
    // preview server owns a separate random loopback origin. `same-origin`
    // makes Chromium block otherwise valid <img> and embedded PDF requests
    // before the renderer can consume them. The server exposes no CORS read
    // permission; `cross-origin` only permits those opaque embeds.
    response.setHeader('cross-origin-resource-policy', 'cross-origin')
    response.setHeader('referrer-policy', 'same-origin')
    response.setHeader('x-content-type-options', 'nosniff')
    if (method !== 'GET' && method !== 'HEAD') { fail(response, 405, 'Method not allowed.'); return }
    const pathname = decodeURIComponent(new URL(rawUrl, 'http://artifact.local').pathname)
    const segments = pathname.split('/').filter(Boolean)
    if (segments.length === 0 || segments.some(segment => segment.startsWith('.') || segment.includes('\0'))) {
      fail(response, 404, 'Artifact resource not found.'); return
    }
    let candidate = resolve(root, ...segments)
    if (!fenced(root, candidate)) { fail(response, 403, 'Artifact resource is outside the preview root.'); return }
    try {
      candidate = await realpath(candidate)
      if (!fenced(root, candidate)) { fail(response, 403, 'Artifact resource is outside the preview root.'); return }
      if ((await stat(candidate)).isDirectory()) {
        candidate = await realpath(join(candidate, 'index.html'))
        if (!fenced(root, candidate)) { fail(response, 403, 'Artifact resource is outside the preview root.'); return }
      }
    } catch { fail(response, 404, 'Artifact resource not found.'); return }
    const mime = MIME_TYPES[extname(candidate).toLowerCase()]
    if (mime === undefined) { fail(response, 403, 'Artifact resource type is not previewable.'); return }
    const content = await readFile(candidate)
    response.statusCode = 200
    response.setHeader('content-type', mime)
    response.setHeader('content-length', String(content.byteLength))
    if (method === 'HEAD') response.end()
    else response.end(content)
  }
}
