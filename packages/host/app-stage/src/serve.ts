/**
 * Dual-source sandboxed static origins for App Stage applications.
 *
 * One loopback webServer prefix serves both supply sources: installed
 * snapshots (`/installed/<appId>/<version>/...`, stable public ids) and
 * workspace dev copies (`/dev/<token>/...`, an opaque capability token per
 * app directory so workspace paths never appear in a URL). Every response
 * carries the sandbox CSP, resolves symlinks before fencing, and refuses
 * anything that escapes its source root.
 * @module @ryanyujazz/dsh-app-stage/serve
 */
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { installedVersionDir } from './store.ts'

export const APP_STAGE_PREFIX = '/deepcreator-app-stage'

/** Sandbox CSP: same-origin subresources only, no forms, framed by the shell itself. */
export const APP_CSP = "default-src 'self'; form-action 'none'; frame-ancestors 'self'"

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif', '.css': 'text/css; charset=utf-8', '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.otf': 'font/otf',
  '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
  '.wav': 'audio/wav', '.webm': 'video/webm', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
}

function fenced(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`) && !resolve(rel).startsWith('..')
}

function fail(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status
  response.setHeader('content-type', 'text/plain; charset=utf-8')
  response.setHeader('content-security-policy', APP_CSP)
  response.end(message)
}

/** One mapped dev source: token → absolute app directory. */
export interface DevOrigin { readonly token: string; readonly dir: string }

/**
 * The static origin registry. `urlForDev`/`urlForInstalled` mint stable URLs;
 * the prefix handler serves every mapped source with the sandbox policy.
 */
export class AppStageStaticServer {
  private readonly devByToken = new Map<string, string>()
  private readonly devByDir = new Map<string, string>()
  private readonly disposeRoute: () => void

  constructor(webServer: WebServer, private readonly origin: string = '') {
    this.disposeRoute = webServer.register({
      kind: 'prefix',
      path: APP_STAGE_PREFIX,
      handler: (request, response) => void this.respond(request.url ?? '/', response),
    })
  }

  /** Absolute origin prefix (loopback webServer origin) for URL minting. */
  get baseUrl(): string { return `${this.origin}${APP_STAGE_PREFIX}` }

  dispose(): void {
    this.disposeRoute()
    this.devByToken.clear()
    this.devByDir.clear()
  }

  /** Mint (or reuse) the stable dev URL for one app source directory. */
  urlForDev(dir: string, entry: string): string {
    let token = this.devByDir.get(dir)
    if (token === undefined) {
      token = createHash('sha256').update(dir).digest('hex').slice(0, 24)
      this.devByDir.set(dir, token)
      this.devByToken.set(token, dir)
    }
    return `${this.baseUrl}/dev/${token}/${entry}`
  }

  /** Stable installed URL for one snapshot version. */
  urlForInstalled(appId: string, version: string, entry: string): string {
    return `${this.baseUrl}/installed/${encodeURIComponent(appId)}/${encodeURIComponent(version)}/${entry}`
  }

  private async respond(url: string, response: ServerResponse): Promise<void> {
    const path = decodeURIComponent(new URL(url, 'http://app.stage').pathname)
    const rest = path.slice(APP_STAGE_PREFIX.length)
    if (rest.startsWith('/dev/')) return this.serveDev(rest.slice('/dev/'.length), response)
    if (rest.startsWith('/installed/')) return this.serveInstalled(rest.slice('/installed/'.length), response)
    return fail(response, 404, 'not found')
  }

  private async serveDev(segment: string, response: ServerResponse): Promise<void> {
    const slash = segment.indexOf('/')
    if (slash <= 0) return fail(response, 404, 'not found')
    const token = segment.slice(0, slash)
    const file = segment.slice(slash + 1)
    const dir = this.devByToken.get(token)
    if (dir === undefined) return fail(response, 404, 'not found')
    await this.serveFile(dir, file, response)
  }

  private async serveInstalled(segment: string, response: ServerResponse): Promise<void> {
    const parts = segment.split('/')
    if (parts.length < 3 || parts[0] === '' || parts[1] === '') return fail(response, 404, 'not found')
    const appId = decodeURIComponent(parts[0]!)
    const version = decodeURIComponent(parts[1]!)
    if (appId.includes('/') || appId.includes('..') || version.includes('/') || version.includes('..')) {
      return fail(response, 404, 'not found')
    }
    await this.serveFile(installedVersionDir(appId, version), parts.slice(2).join('/'), response)
  }

  private async serveFile(root: string, file: string, response: ServerResponse): Promise<void> {
    const target = resolve(root, file)
    if (!fenced(root, target)) return fail(response, 404, 'not found')
    let real: string
    let info: { isFile(): boolean; size: number }
    try {
      real = await realpath(target)
      if (!fenced(root, real)) return fail(response, 404, 'not found')
      info = await stat(real)
    } catch {
      return fail(response, 404, 'not found')
    }
    if (!info.isFile()) return fail(response, 404, 'not found')
    const mediaType = MIME_TYPES[extname(real).toLowerCase()] ?? 'application/octet-stream'
    response.statusCode = 200
    response.setHeader('content-type', mediaType)
    response.setHeader('content-security-policy', APP_CSP)
    response.setHeader('cache-control', 'no-store')
    response.setHeader('x-content-type-options', 'nosniff')
    try {
      response.end(await readFile(real))
    } catch {
      if (!response.writableEnded) fail(response, 500, 'read failed')
    }
  }
}
