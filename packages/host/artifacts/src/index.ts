import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-presentation'
import type { ArtifactReadResult } from './types.ts'
export type { ArtifactReadError, ArtifactReadOk, ArtifactReadResult } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { artifacts: ArtifactReader }
}
declare module '@ryanyujazz/dsh-presentation/types' { interface PresentationInputMap { artifact: { artifactId: string } } }

export const inject = ['presentationRuntime']

/**
 * Read-only workspace file reader for the Workbench Artifact panel. The panel
 * list comes from the Client session-event projection; this service serves
 * instance content for produced paths and conversation-opened Read paths.
 * Paths may be absolute or workspace-relative; every read is sandboxed to the
 * session workspace.
 */
export class ArtifactReader extends TypertRemoteService {
  static inject = inject
  constructor(ctx: Context) {
    super(ctx, 'artifacts')
    const presentation = ctx.presentationRuntime
    if (presentation === undefined) return
    const dispose = presentation.registerResolver({
      kind: 'artifact', description: 'Present a workspace artifact. Fields: kind="artifact", artifactId.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'artifact', required: true }, artifactId: { type: 'string', required: true },
      } },
      parse: input => {
        const value = input as Record<string, unknown>
        if (value.kind !== 'artifact' || typeof value.artifactId !== 'string') throw new Error('artifact presentation requires string artifactId.')
        return { kind: 'artifact' as const, artifactId: value.artifactId }
      },
      materialize: async (_context, input) => ({ kind: 'artifact', id: input.artifactId, mode: 'none' }),
    })
    ctx.effect(() => dispose, 'artifacts: presentation resolver')
  }

  @Remote('read')
  async read(session: Session, path: string): Promise<ArtifactReadResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    try {
      const root = await realpath(cwd)
      const candidate = resolve(root, path)
      // Fence on the canonical form: an absolute input may carry a symlinked
      // prefix (macOS temp roots sit behind /var) that a lexical comparison
      // misreads as an escape. A missing target is fenced lexically first —
      // a path that escapes and does not exist is still an escape.
      let target: string
      try {
        target = await realpath(candidate)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
        const lexical = relative(root, candidate)
        if (isAbsolute(lexical) || lexical === '..' || lexical.startsWith(`..${sep}`)) {
          return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path is outside the session workspace.' }
        }
        return { ok: false, code: 'NOT_FOUND', message: `File ${path} was not found.` }
      }
      const rel = relative(root, target)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) {
        return { ok: false, code: 'OUTSIDE_WORKSPACE', message: 'Artifact path resolves outside the session workspace.' }
      }
      return { ok: true, content: await readFile(target, 'utf8') }
    } catch (error) {
      return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }
}

export default ArtifactReader
