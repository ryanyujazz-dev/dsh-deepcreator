import { createServer, type Server, type ServerResponse } from 'node:http'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { once } from 'node:events'

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
