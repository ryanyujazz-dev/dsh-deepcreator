import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_PRESENTATION_PROMPT, ARTIFACT_RESOLVER_DESCRIPTION, ArtifactReader, resolveArtifactInstanceId,
} from '../src/index.ts'

const temporary: string[] = []
const servers: Server[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })))
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

function artifactContext(): { ctx: Context; route: () => WebRoute } {
  const ctx = new Context()
  let registered: WebRoute | undefined
  ctx.provide('webServer', {
    register: (route: WebRoute) => {
      registered = route
      return () => { if (registered === route) registered = undefined }
    },
  } as WebServer)
  return {
    ctx,
    route: () => {
      if (registered === undefined) throw new Error('Artifact resource route was not registered.')
      return registered
    },
  }
}

async function serveRoute(route: WebRoute): Promise<string> {
  const server = createServer((request, response) => {
    void Promise.resolve(route.handler(request, response)).catch(() => response.destroy())
  })
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Test artifact server did not bind.')
  return `http://127.0.0.1:${address.port}`
}

describe('ArtifactReader', () => {
  it('gives the Agent explicit, selective artifact presentation guidance', async () => {
    const { ctx } = artifactContext()
    new SystemPrompt(ctx, {})
    new ArtifactReader(ctx)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections).toContainEqual({
      name: 'deepcreator:artifact-presentation',
      text: ARTIFACT_PRESENTATION_PROMPT,
    })
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('proactively present one primary user-consumable workspace artifact')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('workspace output/ directory')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('session attachment alone does not necessarily deliver')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('do not persist every intermediate screenshot')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('Do not open ordinary source files')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('do not reopen a resource')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('workspacePath')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('visible image block already delivers')
    expect(ARTIFACT_RESOLVER_DESCRIPTION).toContain('present the primary output once')
    expect(ARTIFACT_RESOLVER_DESCRIPTION).toContain('workspacePath')
    expect(ARTIFACT_RESOLVER_DESCRIPTION).toContain('never pass an attachmentId')
  })

  it('registers workspacePath as the only artifact presentation locator', async () => {
    const { ctx } = artifactContext()
    const registerResolver = vi.fn((_resolver: unknown) => () => undefined)
    ctx.provide('presentationRuntime', { registerResolver } as never)
    new ArtifactReader(ctx)

    const resolver = registerResolver.mock.calls[0]?.[0] as {
      inputSchema: unknown
      parse(input: unknown): unknown
    }
    expect(resolver.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: { workspacePath: { type: 'string', required: true } },
    })
    expect(JSON.stringify(resolver.inputSchema)).not.toContain('artifactId')
    expect(resolver.parse({ kind: 'artifact', workspacePath: 'output/report.md' })).toEqual({ kind: 'artifact', workspacePath: 'output/report.md' })
    expect(() => resolver.parse({ kind: 'artifact', artifactId: 'sha256:legacy' })).toThrow('workspacePath')
    expect(() => resolver.parse({ kind: 'artifact', workspacePath: 'sha256:legacy' })).toThrow('not an attachment id')
    expect(() => resolver.parse({ kind: 'artifact', workspacePath: 'https://example.test/report.md' })).toThrow('not an attachment id')
    await ctx.fiber.dispose()
  })

  it('routes Agent-presented HTML artifacts through the built-in Browser resource', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    await writeFile(join(workspace, 'prototype.html'), '<!doctype html><title>Prototype</title>')
    await writeFile(join(workspace, 'report.md'), '# Report')
    const { ctx } = artifactContext()
    const materializeUrl = vi.fn(async () => ({ kind: 'browser-tab', id: 'iab-tab-1', mode: 'live' as const }))
    const settleUrl = vi.fn(async () => undefined)
    ctx.provide('browserPresentation', { materializeUrl, settleUrl } as never)
    let registered: {
      materialize(context: {
        sessionId: string
        turn: number
        workspaceRoot: string
        signal: { readonly aborted: boolean; subscribe(listener: () => void): () => void }
      }, input: { kind: 'artifact'; workspacePath: string }): Promise<{ kind: string; id: string; mode?: string }>
      settle?(context: {
        sessionId: string
        turn: number
        workspaceRoot: string
        signal: { readonly aborted: boolean; subscribe(listener: () => void): () => void }
        result: { requestId: string; status: 'presented' }
      }, input: { kind: 'artifact'; workspacePath: string }, resource: { kind: string; id: string; mode?: string }): Promise<void>
    } | undefined
    ctx.provide('presentationRuntime', {
      registerResolver: (resolver: typeof registered) => { registered = resolver; return () => undefined },
    } as never)
    new ArtifactReader(ctx)
    if (registered === undefined) throw new Error('artifact resolver was not registered')
    const signal = { aborted: false, subscribe: () => () => undefined }
    const context = { sessionId: 's1', turn: 4, workspaceRoot: workspace, signal }

    await expect(registered.materialize(context, { kind: 'artifact', workspacePath: 'prototype.html' }))
      .resolves.toEqual({ kind: 'browser-tab', id: 'iab-tab-1', mode: 'live' })
    expect(materializeUrl).toHaveBeenCalledWith(
      context,
      { url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/prototype\.html$/), browserId: 'iab' },
    )
    await expect(registered.materialize(context, { kind: 'artifact', workspacePath: 'report.md' }))
      .resolves.toMatchObject({ kind: 'artifact', id: join(workspace, 'report.md'), mode: 'none' })

    const resource = { kind: 'browser-tab', id: 'iab-tab-1', mode: 'live' }
    const settleContext = { ...context, result: { requestId: 'request-1', status: 'presented' as const } }
    await registered.settle?.(settleContext, { kind: 'artifact', workspacePath: 'prototype.html' }, resource)
    expect(settleUrl).toHaveBeenCalledWith(settleContext, resource, true)
    await ctx.fiber.dispose()
  })

  it('reads workspace files by absolute or relative path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    await writeFile(join(workspace, 'plan.md'), '# plan')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(artifactContext().ctx)
    await expect(reader.read(session, join(workspace, 'plan.md'))).resolves.toMatchObject({ ok: true, kind: 'text', content: '# plan' })
    await expect(reader.read(session, 'plan.md')).resolves.toMatchObject({ ok: true, kind: 'text', content: '# plan' })
  })

  it('gives Markdown, JPG, and PNG workspace paths one canonical presentation identity', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    for (const name of ['notes.md', 'photo.jpg', 'image.png']) {
      const path = join(workspace, name)
      await writeFile(path, 'artifact')
      await expect(resolveArtifactInstanceId(workspace, name)).resolves.toBe(path)
      await expect(resolveArtifactInstanceId(workspace, path)).resolves.toBe(path)
    }
  })

  it('reads absolute paths that carry a symlinked workspace prefix', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const linkedRoot = await mkdtemp(join(tmpdir(), 'dsh-artifacts-linked-')); temporary.push(linkedRoot)
    const linked = join(linkedRoot, 'link')
    // Windows directory symlinks need Developer Mode or admin; junctions do
    // not, and resolve to the same canonical target the reader must accept.
    await symlink(workspace, linked, process.platform === 'win32' ? 'junction' : undefined)
    await writeFile(join(workspace, 'plan.md'), '# plan')
    const session = { id: 's1', header: { cwd: linked } } as unknown as Session
    const reader = new ArtifactReader(artifactContext().ctx)
    await expect(reader.read(session, join(linked, 'plan.md'))).resolves.toMatchObject({ ok: true, kind: 'text', content: '# plan' })
  })

  it('rejects paths that escape the canonical workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-artifacts-outside-')); temporary.push(outside)
    await writeFile(join(outside, 'secret.md'), 'secret')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(artifactContext().ctx)
    await expect(reader.read(session, join(outside, 'secret.md'))).resolves.toMatchObject({ ok: false, code: 'OUTSIDE_WORKSPACE' })
    await expect(reader.read(session, '../escape.md')).resolves.toMatchObject({ ok: false, code: 'OUTSIDE_WORKSPACE' })
  })

  it('does not expose hidden workspace files through artifact reads', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    await writeFile(join(workspace, '.env'), 'TOKEN=secret')
    await mkdir(join(workspace, '.private'))
    await writeFile(join(workspace, '.private', 'note.txt'), 'secret')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(artifactContext().ctx)
    await expect(reader.read(session, '.env')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })
    await expect(reader.read(session, '.private/note.txt')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })
  })

  it('reports missing files and sessions without a workspace explicitly', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(artifactContext().ctx)
    await expect(reader.read(session, 'missing.md')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })
    await expect(reader.read({ id: 's1', header: {} } as unknown as Session, 'a.md')).resolves.toMatchObject({ ok: false, code: 'NO_WORKSPACE' })
  })

  it('returns fenced in-panel render payloads for images, PDFs and DOCX documents', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    await writeFile(join(workspace, 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await writeFile(join(workspace, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff]))
    await writeFile(join(workspace, 'report.pdf'), '%PDF-1.4\n%%EOF')
    const docxFixture = join(process.cwd(), 'packages/host/artifacts/node_modules/mammoth/test/test-data/single-paragraph.docx')
    await writeFile(join(workspace, 'brief.docx'), await readFile(docxFixture))
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const harness = artifactContext()
    const { ctx } = harness
    const reader = new ArtifactReader(ctx)
    const origin = await serveRoute(harness.route())

    const image = await reader.read(session, 'chart.png')
    expect(image).toMatchObject({ ok: true, kind: 'image', mediaType: 'image/png', url: expect.stringMatching(/^\/deepcreator-artifacts\/[A-Za-z0-9_-]+$/) })
    await expect(reader.read(session, 'photo.jpg')).resolves.toMatchObject({ ok: true, kind: 'image', mediaType: 'image/jpeg' })
    if (!image.ok || image.kind !== 'image') throw new Error('image payload missing')
    await expect(fetch(`${origin}${image.url}`).then(response => ({
      contentType: response.headers.get('content-type'),
      cacheControl: response.headers.get('cache-control'),
      referrerPolicy: response.headers.get('referrer-policy'),
    }))).resolves.toEqual({
      contentType: 'image/png',
      cacheControl: 'private, no-store',
      referrerPolicy: 'no-referrer',
    })

    const pdf = await reader.read(session, 'report.pdf')
    expect(pdf).toMatchObject({ ok: true, kind: 'pdf', mediaType: 'application/pdf', url: expect.stringMatching(/^\/deepcreator-artifacts\/[A-Za-z0-9_-]+$/) })
    if (!pdf.ok || pdf.kind !== 'pdf') throw new Error('pdf payload missing')
    await expect(fetch(`${origin}${pdf.url}`).then(response => response.headers.get('content-type'))).resolves.toBe('application/pdf')
    await expect(fetch(`${origin}${pdf.url}`, { headers: { range: 'bytes=0-7' } }).then(async response => ({
      status: response.status,
      acceptRanges: response.headers.get('accept-ranges'),
      contentRange: response.headers.get('content-range'),
      contentLength: response.headers.get('content-length'),
      body: await response.text(),
    }))).resolves.toEqual({
      status: 206,
      acceptRanges: 'bytes',
      contentRange: 'bytes 0-7/14',
      contentLength: '8',
      body: '%PDF-1.4',
    })

    await expect(reader.read(session, 'brief.docx')).resolves.toMatchObject({
      ok: true, kind: 'document', contentType: 'html', content: expect.stringContaining('<p>'),
    })
    await ctx.fiber.dispose()
  })

  it('serves HTML artifacts and their web assets from a fenced loopback preview', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const site = join(workspace, 'site')
    await mkdir(join(site, 'assets'), { recursive: true })
    await writeFile(join(site, 'index.html'), '<!doctype html><link rel="stylesheet" href="/assets/app.css"><h1>Preview</h1>')
    await writeFile(join(site, 'assets', 'app.css'), 'h1 { color: red; }')
    await writeFile(join(site, '.env'), 'SECRET=hidden')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const { ctx } = artifactContext()
    const reader = new ArtifactReader(ctx)

    const preview = await reader.preview(session, 'site/index.html')
    expect(preview).toMatchObject({ ok: true, url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/index\.html$/) })
    if (!preview.ok) throw new Error(preview.message)
    await expect(fetch(preview.url).then(response => response.text())).resolves.toContain('<h1>Preview</h1>')
    await expect(fetch(new URL('/assets/app.css', preview.url)).then(response => ({ status: response.status, text: response.text() })))
      .resolves.toMatchObject({ status: 200 })
    await expect(fetch(new URL('/.env', preview.url)).then(response => response.status)).resolves.toBe(404)

    await ctx.fiber.dispose()
  })

  it('refuses browser previews for non-HTML artifacts', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    await writeFile(join(workspace, 'plan.md'), '# plan')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(artifactContext().ctx)
    await expect(reader.preview(session, 'plan.md')).resolves.toMatchObject({ ok: false, code: 'NOT_PREVIEWABLE' })
  })
})
