/**
 * M5d serve-layer tests: HTML runtime injection (before `</head>`, sane
 * fallbacks, non-HTML untouched), the runtime script route, the SSE event
 * endpoint (replay window, live fan-out, appId filtering, close-unsubscribe),
 * and the injected runtime's syntax validity plus its no-API invariants.
 * Installed-origin plumbing is covered through the dev route (same
 * serveFile path) so tests never touch the real install store.
 * @module @ryanyujazz/dsh-app-stage/tests/serve.presence.spec
 */
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppStageStaticServer, APP_STAGE_PREFIX, injectPresenceTag } from '../src/serve.ts'
import { PRESENCE_RUNTIME_JS } from '../src/presence-runtime.ts'
import type { PresenceEvent, PresenceCoordinator } from '../src/presence.ts'

/** Minimal ServerResponse double: captures writes/headers/status. */
class FakeResponse {
  statusCode = 0
  readonly headers = new Map<string, string>()
  readonly chunks: string[] = []
  writableEnded = false
  private readonly closeListeners: Array<() => void> = []
  setHeader(name: string, value: string): this { this.headers.set(name.toLowerCase(), value); return this }
  write(chunk: string): boolean { this.chunks.push(chunk); return true }
  end(chunk?: string): this { if (chunk !== undefined) this.chunks.push(chunk); this.writableEnded = true; return this }
  on(event: 'close', listener: () => void): this { if (event === 'close') this.closeListeners.push(listener); return this }
  /** Test seam: simulate the socket closing. */
  close(): void { for (const listener of this.closeListeners) listener() }
  get body(): string { return this.chunks.join('') }
}

/** A static server plus a raw respond() entry for FakeResponse drives. */
async function makeServer(): Promise<{ server: AppStageStaticServer; respond: (url: string, response: FakeResponse) => Promise<void> }> {
  let captured: ((request: { url: string }, response: unknown) => void) | undefined
  const webServer = { register: (route: { handler: (request: { url: string }, response: unknown) => void }) => {
    captured = route.handler
    return () => { captured = undefined }
  } }
  void captured
  void webServer
  const server = new AppStageStaticServer(webServer as never, 'http://127.0.0.1:1')
  // The registered route voids its promise (fire-and-forget in production),
  // so tests drive the private respond directly to await completion.
  const inner = (server as unknown as { respond(url: string, response: unknown): Promise<void> }).respond.bind(server)
  const respond = (url: string, response: FakeResponse): Promise<void> => inner(url, response)
  return { server, respond }
}

/** A dev app directory on a realpath-resolved temp root (macOS /var symlink). */
async function devApp(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'app-presence-')))
  const dir = join(root, 'my-dev-app')
  await mkdir(dir, { recursive: true })
  for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body)
  return dir
}

const HTML = '<!doctype html><html><head><meta charset="utf-8"><title>app</title></head><body><p>hi</p></body></html>'

describe('injectPresenceTag', () => {
  it('splices the deferred runtime before </head> with the app binding', () => {
    const out = injectPresenceTag(HTML, 'kanban-demo')
    expect(out).toContain(`<script src="${APP_STAGE_PREFIX}/__dsh_presence__.js" data-dsh-app="kanban-demo" defer></script></head>`)
  })

  it('falls back to after <head>, escapes the attribute, prepends for fragments', () => {
    const escaped = injectPresenceTag('<html><head><title>x</title></head></html>', 'a"b')
    expect(escaped).toContain('data-dsh-app="a%22b"')
    const noClose = injectPresenceTag('<html><head lang="en"><body></body></html>', 'app')
    expect(noClose.indexOf('data-dsh-app="app"')).toBeGreaterThan(noClose.indexOf('<head lang="en">'))
    expect(injectPresenceTag('<p>fragment</p>', 'app').startsWith('<script')).toBe(true)
  })
})

describe('static server presence routes', () => {
  it('serves the runtime script with JS mime and the sandbox CSP', async () => {
    const { respond } = await makeServer()
    const response = new FakeResponse()
    await respond(`${APP_STAGE_PREFIX}/__dsh_presence__.js`, response)
    expect(response.statusCode).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('content-security-policy')).toBeTruthy()
    expect(response.body).toBe(PRESENCE_RUNTIME_JS)
  })

  it('injects the runtime into app HTML with the directory binding; non-HTML stays byte-identical', async () => {
    const dir = await devApp({ 'index.html': HTML, 'app.js': 'console.log(1)' })
    const { server, respond } = await makeServer()
    const base = server.urlForDev(dir, 'index.html').slice('http://127.0.0.1:1'.length)
    const html = new FakeResponse()
    await respond(base, html)
    expect(html.body).toContain('data-dsh-app="my-dev-app"')
    expect(html.body).toContain('__dsh_presence__.js"')
    const js = new FakeResponse()
    await respond(base.replace('index.html', 'app.js'), js)
    expect(js.body).toBe('console.log(1)')
  })
})

describe('SSE event endpoint', () => {
  const makeSource = () => {
    const recent: PresenceEvent[] = [
      { seq: 1, appId: 'kanban-demo', kind: 'lease', ts: 1, payload: { phase: 'active' } },
    ]
    const listeners = new Set<(event: PresenceEvent) => void>()
    return {
      recentEvents: (appId?: string) => recent.filter(event => appId === undefined || event.appId === appId),
      subscribeEvents: (appId: string | undefined, listener: (event: PresenceEvent) => void) => {
        const wrapped = (event: PresenceEvent): void => { if (appId === undefined || event.appId === appId) listener(event) }
        listeners.add(wrapped)
        return () => { listeners.delete(wrapped) }
      },
      publish: (event: PresenceEvent): void => { for (const listener of listeners) listener(event) },
      subscribers: (): number => listeners.size,
    }
  }

  it('replays the window, streams live events filtered, and unsubscribes on close', async () => {
    const source = makeSource()
    const { server, respond } = await makeServer()
    server.setPresenceSource(source)
    const response = new FakeResponse()
    await respond(`${APP_STAGE_PREFIX}/__dsh_presence__/events?appId=kanban-demo`, response)
    expect(response.statusCode).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.body).toContain('retry: 3000')
    expect(response.body).toContain('"seq":1')
    source.publish({ seq: 2, appId: 'kanban-demo', kind: 'command', ts: 2, payload: { phase: 'start', commandKind: 'invoke' } })
    expect(response.body).toContain('"seq":2')
    // Another app's events stay filtered out of this subscription.
    source.publish({ seq: 3, appId: 'other', kind: 'command', ts: 3, payload: { phase: 'start', commandKind: 'invoke' } })
    expect(response.body).not.toContain('"seq":3')
    expect(source.subscribers()).toBe(1)
    response.close()
    expect(source.subscribers()).toBe(0)
  })

  it('reports 503 before a presence source is wired', async () => {
    const { respond } = await makeServer()
    const response = new FakeResponse()
    await respond(`${APP_STAGE_PREFIX}/__dsh_presence__/events`, response)
    expect(response.statusCode).toBe(503)
  })
})

describe('injected runtime source', () => {
  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(PRESENCE_RUNTIME_JS)).not.toThrow()
  })

  it('declares no globals and renders only through a closed, inert overlay', () => {
    expect(PRESENCE_RUNTIME_JS).not.toContain('window.dsh')
    expect(PRESENCE_RUNTIME_JS).toContain("attachShadow({ mode: 'closed' })")
    expect(PRESENCE_RUNTIME_JS).toContain('pointer-events:none')
    expect(PRESENCE_RUNTIME_JS).toContain("EventSource('/deepcreator-app-stage/__dsh_presence__/events')")
    // Reduced motion is an explicit degrade, not a silent fail.
    expect(PRESENCE_RUNTIME_JS).toContain('prefers-reduced-motion')
  })
})

describe('coordinator event stream (M5d host side)', () => {
  it('emits lease and command events with seq, and replays them filtered', async () => {
    const { PresenceCoordinator } = await import('../src/presence.ts')
    const presence: PresenceCoordinator = new PresenceCoordinator()
    const seen: PresenceEvent[] = []
    presence.subscribeEvents('kanban-demo', event => { seen.push(event) })
    presence.commandStarted('s1', { kind: 'invoke', appId: 'kanban-demo', appName: '看板演示', action: 'createTask', origin: 'installed' })
    presence.commandSettled('s1', { ts: Date.now(), kind: 'invoke', appId: 'kanban-demo', appName: '看板演示', action: 'createTask', outcome: 'ok', durationMs: 5, origin: 'installed' })
    presence.takeover('s1', { appId: 'kanban-demo', name: '看板演示' }, false)
    presence.handback('s1')
    expect(seen.map(event => [event.kind, event.payload.phase])).toEqual([
      ['command', 'start'],
      ['command', 'settled'],
      ['lease', 'active'],
      ['lease', 'released'],
    ])
    expect(seen[0]!.seq).toBeLessThan(seen[3]!.seq)
    expect(presence.recentEvents('kanban-demo')).toHaveLength(seen.length)
    expect(presence.recentEvents('other-app')).toHaveLength(0)
  })
})
