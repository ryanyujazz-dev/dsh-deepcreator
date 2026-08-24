import { readFile, realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-presentation'
import type { PresentationMaterializeContext, PresentationResource, PresentationSettleContext } from '@ryanyujazz/dsh-presentation'
import type { BrowserPresentationService } from '@ryanyujazz/dsh-browser'
import mammoth from 'mammoth'
import WordExtractor from 'word-extractor'
import { ArtifactPreviewRegistry, ArtifactResourceRegistry } from './preview-server.ts'
import type { ArtifactPreviewResult, ArtifactReadError, ArtifactReadResult } from './types.ts'
export type {
  ArtifactDocumentReadOk, ArtifactImageReadOk, ArtifactPdfReadOk, ArtifactPreviewError,
  ArtifactPreviewOk, ArtifactPreviewResult, ArtifactReadError, ArtifactReadOk, ArtifactReadResult,
  ArtifactTextReadOk,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { artifacts: ArtifactReader }
}
declare module '@ryanyujazz/dsh-presentation/types' { interface PresentationInputMap { artifact: { workspacePath: string } } }

export const inject = ['presentationRuntime', 'systemPrompt', 'webServer']

export const ARTIFACT_PRESENTATION_PROMPT = [
  'Distinguish disposable internal observations from user-consumable artifacts; a successful tool call, preview, temporary file, or session attachment alone does not necessarily deliver a requested artifact.',
  'Use the workspace output/ directory for valuable non-project artifacts that the user requested or would reasonably expect to keep, and verify the returned path before finishing.',
  'Use judgment: preserve requested results, important evidence, final states, before/after comparisons, and costly-to-reproduce outputs, but do not persist every intermediate screenshot, trace, or temporary file.',
  'When open_in_deepcreator is available, proactively present one primary user-consumable workspace artifact after creating and verifying it, using its verified workspace path rather than an attachment id or content hash.',
  'A visible image block already delivers its session attachment; reopen it as an artifact only when a workspace output file exists, and then pass that output path as workspacePath.',
  'User-consumable artifacts include reports, documents, images, exported files, and standalone viewable prototype entry files.',
  'Do not open ordinary source files, tests, configuration, dependency metadata, temporary files, or every file in a multi-file implementation merely because they changed.',
  'When several artifacts form one result, present the main entry point once and leave the rest in the produced-files list.',
  'Do not present when the user asked not to, and do not reopen a resource whose presentation was suppressed or that the user dismissed during the current turn.',
  'Only status="presented" proves the user can see it; report unavailable presentation honestly.',
].join(' ')

export const ARTIFACT_RESOLVER_DESCRIPTION = [
  'Present a primary user-consumable workspace artifact.',
  'After creating and verifying a report, document, image, export, or standalone prototype entry file, present the primary output once unless the user asked not to.',
  'HTML and HTM entry files open in the built-in DeepCreator Browser; other files open in the Artifact panel.',
  'Do not proactively present ordinary source, test, config, dependency, temporary, or secondary implementation files.',
  'Fields: kind="artifact", workspacePath. workspacePath must be the verified absolute or workspace-relative path of an existing file; never pass an attachmentId, content hash, or URL.',
].join(' ')

/**
 * Read-only workspace file reader for the Workbench Artifact panel. The panel
 * list comes from the Client session-event projection; this service serves
 * instance content for produced paths and conversation-opened Read paths.
 * Paths may be absolute or workspace-relative; every read is sandboxed to the
 * session workspace.
 */
export class ArtifactReader extends TypertRemoteService {
  static inject = inject
  private readonly previews = new ArtifactPreviewRegistry()
  private readonly resources: ArtifactResourceRegistry
  private readonly wordExtractor = new WordExtractor()
  constructor(ctx: Context) {
    super(ctx, 'artifacts')
    this.resources = new ArtifactResourceRegistry(ctx.webServer)
    ctx.effect(() => () => { void this.previews.dispose() }, 'artifacts: preview server')
    ctx.effect(() => () => { this.resources.dispose() }, 'artifacts: same-origin resources')
    ctx.systemPrompt?.section({
      name: 'deepcreator:artifact-presentation',
      order: 191,
      text: ARTIFACT_PRESENTATION_PROMPT,
    })
    const presentation = ctx.presentationRuntime
    if (presentation === undefined) return
    const browserPresentation = (): BrowserPresentationService => {
      const browser = ctx.get('browserPresentation') as BrowserPresentationService | undefined
      if (browser === undefined) throw new Error('BROWSER_UNAVAILABLE: HTML artifacts require the DeepCreator Browser Runtime.')
      return browser
    }
    const dispose = presentation.registerResolver({
      kind: 'artifact', description: ARTIFACT_RESOLVER_DESCRIPTION,
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'artifact', required: true },
        workspacePath: { type: 'string', required: true, description: 'Verified absolute or workspace-relative path of an existing workspace file. Attachment ids, content hashes, and URLs are invalid.' },
      } },
      parse: input => {
        const value = input as Record<string, unknown>
        if (value.kind !== 'artifact' || typeof value.workspacePath !== 'string') throw new Error('artifact presentation requires string workspacePath.')
        if (value.workspacePath.trim() === '' || /^(?:sha256|attachment):/i.test(value.workspacePath) || /^[a-z][a-z\d+.-]*:\/\//i.test(value.workspacePath)) {
          throw new Error('artifact presentation workspacePath must name an existing workspace file, not an attachment id, content hash, or URL.')
        }
        return { kind: 'artifact' as const, workspacePath: value.workspacePath }
      },
      materialize: async (context: PresentationMaterializeContext, input) => {
        const target = await resolveArtifactInstanceId(context.workspaceRoot, input.workspacePath)
        if (!['.html', '.htm'].includes(extname(target).toLowerCase())) {
          return { kind: 'artifact', id: target, mode: 'none' }
        }
        // Artifact instance identity preserves the Session's path spelling
        // (notably macOS /var vs /private/var), while the preview registry
        // computes a relative URL against a canonical directory root.
        const url = await this.previews.urlFor(await realpath(target))
        return browserPresentation().materializeUrl(context, { url, browserId: 'iab' })
      },
      settle: async (context: PresentationSettleContext, _input, resource: PresentationResource) => {
        if (resource.kind !== 'browser-tab') return
        await browserPresentation().settleUrl(context, resource, true)
      },
    })
    ctx.effect(() => dispose, 'artifacts: presentation resolver')
  }

  @Remote('read')
  async read(session: Session, path: string): Promise<ArtifactReadResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    try {
      const resolved = await resolveArtifact(cwd, path)
      if (!resolved.ok) return resolved
      const { target } = resolved
      const extension = extname(target).toLowerCase()
      const imageType = IMAGE_MEDIA_TYPES[extension]
      if (imageType !== undefined) {
        return { ok: true, kind: 'image', url: await this.resources.urlFor(target), mediaType: imageType }
      }
      if (extension === '.pdf') {
        return { ok: true, kind: 'pdf', url: await this.resources.urlFor(target), mediaType: 'application/pdf' }
      }
      if (extension === '.docx') {
        const result = await mammoth.convertToHtml(
          { path: target },
          { convertImage: mammoth.images.dataUri, externalFileAccess: false },
        )
        return { ok: true, kind: 'document', contentType: 'html', content: result.value }
      }
      if (extension === '.doc') {
        const document = await this.wordExtractor.extract(target)
        return { ok: true, kind: 'document', contentType: 'text', content: document.getBody() }
      }
      return { ok: true, kind: 'text', content: await readFile(target, 'utf8') }
    } catch (error) {
      return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Materialize an HTML artifact as a loopback URL for Browser/Presentation. */
  @Remote('preview')
  async preview(session: Session, path: string): Promise<ArtifactPreviewResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    try {
      const resolved = await resolveArtifact(cwd, path)
      if (!resolved.ok) return resolved
      if (!['.html', '.htm'].includes(extname(resolved.target).toLowerCase())) {
        return { ok: false, code: 'NOT_PREVIEWABLE', message: 'Only HTML artifacts can be opened as a browser preview.' }
      }
      return { ok: true, url: await this.previews.urlFor(resolved.target), path: resolved.target }
    } catch (error) {
      return { ok: false, code: 'PREVIEW_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

const IMAGE_MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

type ResolvedArtifact = { ok: true; target: string } | ArtifactReadError

/** Stable presentation identity under the Session workspace's lexical root. */
export async function resolveArtifactInstanceId(cwd: string, path: string): Promise<string> {
  const resolved = await resolveArtifact(cwd, path)
  if (!resolved.ok) throw new Error(`${resolved.code}: ${resolved.message}`)
  const canonicalRoot = await realpath(cwd)
  return resolve(cwd, relative(canonicalRoot, resolved.target))
}

async function resolveArtifact(cwd: string, path: string): Promise<ResolvedArtifact> {
  const root = await realpath(cwd)
  const candidate = resolve(root, path)
  // Fence on the canonical form: an absolute input may carry a symlinked
  // prefix (macOS temp roots sit behind /var) that a lexical comparison
  // misreads as an escape. A missing target is fenced lexically first.
  let target: string
  try {
    target = await realpath(candidate)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const lexical = relative(root, candidate)
    if (isAbsolute(lexical) || lexical === '..' || lexical.startsWith(`..${sep}`)) {
      return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path is outside the session workspace.' }
    }
    if (lexical.split(sep).some(segment => segment.startsWith('.'))) {
      return { ok: false, code: 'NOT_FOUND', message: 'Hidden artifact paths are not previewable.' }
    }
    return { ok: false, code: 'NOT_FOUND', message: `File ${path} was not found.` }
  }
  const rel = relative(root, target)
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
    return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path resolves outside the session workspace.' }
  }
  if (rel.split(sep).some(segment => segment.startsWith('.'))) {
    return { ok: false, code: 'NOT_FOUND', message: 'Hidden artifact paths are not previewable.' }
  }
  return { ok: true, target }
}

export default ArtifactReader
