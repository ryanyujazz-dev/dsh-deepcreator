import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { ReviewChecksResult, ReviewDiffResult, ReviewStatusResult } from './types.ts'

export type { ReviewChecksResult, ReviewDiffResult, ReviewFileStatus, ReviewStatusResult } from './types.ts'

const exec = promisify(execFile)

declare module '@deepseek-ai/cordis' { interface Context { review: ReviewService } }

class ReviewBoundaryError extends Error {
  constructor(readonly code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE', message: string) { super(message) }
}

async function repositoryFor(session: Session): Promise<{ workspace: string; repository: string }> {
  const cwd = session.header.cwd
  if (cwd === undefined) throw new ReviewBoundaryError('NO_WORKSPACE', 'This session has no workspace.')
  const workspace = await realpath(cwd)
  let stdout: string
  try { ({ stdout } = await exec('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })) }
  catch { throw new ReviewBoundaryError('NOT_REPOSITORY', 'The session workspace is not inside a Git repository.') }
  const repository = await realpath(stdout.trim())
  const isWithin = (parent: string, child: string) => {
    const rel = relative(parent, child)
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  }
  const workspaceInsideRepository = isWithin(repository, workspace)
  const repositoryInsideWorkspace = isWithin(workspace, repository)
  if (!workspaceInsideRepository && !repositoryInsideWorkspace) throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Repository root is unrelated to the session workspace.')
  return { workspace, repository }
}

function boundaryFailure(error: unknown): { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string } {
  if (error instanceof ReviewBoundaryError) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'NOT_REPOSITORY', message: error instanceof Error ? error.message : String(error) }
}

/** Host read-only repository service (`ctx.review`). */
export class ReviewService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'review') }

  @Remote('status')
  async status(session: Session): Promise<ReviewStatusResult> {
    try {
      const { repository } = await repositoryFor(session)
      const { stdout } = await exec('git', ['-C', repository, 'status', '--porcelain=v1', '--branch'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      const lines = stdout.split(/\r?\n/u).filter(Boolean)
      const branch = lines[0]?.startsWith('## ') === true ? lines.shift()!.slice(3) : ''
      const files = lines.map(line => ({ index: line[0] ?? ' ', workingTree: line[1] ?? ' ', path: line.slice(3) }))
      return { ok: true, repositoryRoot: repository, branch, files }
    } catch (error) { return boundaryFailure(error) }
  }

  @Remote('diff')
  async diff(session: Session, path: string): Promise<ReviewDiffResult> {
    let repository: string
    try { ({ repository } = await repositoryFor(session)) }
    catch (error) { return boundaryFailure(error) }
    try {
      if (isAbsolute(path)) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path must be repository-relative.' }
      const target = resolve(repository, path)
      const rel = relative(repository, target)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path is outside the repository.' }
      const [working, staged] = await Promise.all([
        exec('git', ['-C', repository, 'diff', '--no-ext-diff', '--', rel], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
        exec('git', ['-C', repository, 'diff', '--cached', '--no-ext-diff', '--', rel], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }),
      ])
      return { ok: true, repositoryRoot: repository, path: rel, diff: [staged.stdout, working.stdout].filter(Boolean).join('\n') }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('checks')
  async checks(session: Session): Promise<ReviewChecksResult> {
    try {
      const { repository } = await repositoryFor(session)
      try {
        const { stdout, stderr } = await exec('git', ['-C', repository, 'diff', '--check'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
        return { ok: true, repositoryRoot: repository, clean: true, output: `${stdout}${stderr}` }
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string }
        return { ok: true, repositoryRoot: repository, clean: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
      }
    } catch (error) { return boundaryFailure(error) }
  }
}

export default ReviewService
