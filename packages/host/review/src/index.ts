import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ReviewChecksResult, ReviewDiffResult, ReviewPatchLayer, ReviewStatusResult,
} from './types.ts'

export type {
  ReviewChecksResult, ReviewDiffResult, ReviewFileStatus, ReviewPatchLayer,
  ReviewSourceSnapshot, ReviewStatusResult,
} from './types.ts'

const exec = promisify(execFile)

function parsePorcelainStatus(stdout: string): { branch: string; files: Array<{ index: string; workingTree: string; path: string; oldPath?: string }> } {
  const records = stdout.split('\0')
  const branchRecord = records.shift() ?? ''
  const branch = branchRecord.startsWith('## ') ? branchRecord.slice(3) : ''
  const files: Array<{ index: string; workingTree: string; path: string; oldPath?: string }> = []

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record === '') continue
    const indexStatus = record[0] ?? ' '
    const workingTreeStatus = record[1] ?? ' '
    const firstPath = record.slice(3)
    if (indexStatus === 'R' || indexStatus === 'C' || workingTreeStatus === 'R' || workingTreeStatus === 'C') {
      const previousPath = records[index + 1]
      if (previousPath !== undefined && previousPath !== '') {
        // Porcelain v1 -z reverses the human format: destination first, source second.
        files.push({ index: indexStatus, workingTree: workingTreeStatus, path: firstPath, oldPath: previousPath })
        index += 1
        continue
      }
    }
    files.push({ index: indexStatus, workingTree: workingTreeStatus, path: firstPath })
  }

  return { branch, files }
}

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

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

async function gitText(repository: string, revision: 'HEAD' | ':', path: string): Promise<string | null> {
  const expression = revision === ':' ? `:${path}` : `${revision}:${path}`
  try {
    const { stdout } = await exec('git', ['-C', repository, 'show', expression], { encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 })
    return stdout
  } catch { return null }
}

async function worktreeText(repository: string, path: string): Promise<string | null> {
  const target = resolve(repository, path)
  try {
    const canonical = await realpath(target)
    if (!isWithin(repository, canonical)) throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Review path resolves outside the repository.')
    return await readFile(canonical, 'utf8')
  } catch (error) {
    if (error instanceof ReviewBoundaryError) throw error
    return null
  }
}

async function gitDiff(repository: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec('git', ['-C', repository, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (error) {
    const failure = error as { code?: number; stdout?: string }
    if (failure.code === 1 && typeof failure.stdout === 'string') return failure.stdout
    throw error
  }
}

/** Host read-only repository service (`ctx.review`). */
export class ReviewService extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'review') }

  @Remote('status')
  async status(session: Session): Promise<ReviewStatusResult> {
    try {
      const { repository } = await repositoryFor(session)
      const { stdout } = await exec('git', ['-C', repository, 'status', '--porcelain=v1', '--branch', '-z'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      const { branch, files } = parsePorcelainStatus(stdout)
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
      const statusResult = await exec('git', ['-C', repository, 'status', '--porcelain=v1', '--branch', '-z'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
      const status = parsePorcelainStatus(statusResult.stdout).files.find(file => file.path === rel)
      const oldPath = status?.oldPath ?? rel
      // Resolve and fence the worktree target before any command may read it.
      const currentText = await worktreeText(repository, rel)
      const [headText, indexText] = await Promise.all([
        gitText(repository, 'HEAD', oldPath),
        gitText(repository, ':', rel),
      ])
      const [workingPatch, stagedPatch] = await Promise.all([
        status?.index === '?' && status.workingTree === '?' && currentText !== null
          ? gitDiff(repository, ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', rel])
          : gitDiff(repository, ['diff', '--no-ext-diff', '--find-renames', '--find-copies', '--unified=3', '--', oldPath, rel]),
        gitDiff(repository, ['diff', '--cached', '--no-ext-diff', '--find-renames', '--find-copies', '--unified=3', '--', oldPath, rel]),
      ])
      const layers: ReviewPatchLayer[] = []
      if (stagedPatch !== '') layers.push({
        kind: 'staged', patch: stagedPatch,
        oldSource: { revision: 'head', text: headText },
        newSource: { revision: 'index', text: indexText },
      })
      if (workingPatch !== '') layers.push({
        kind: 'working-tree', patch: workingPatch,
        oldSource: { revision: 'index', text: indexText },
        newSource: { revision: 'worktree', text: currentText },
      })
      return { ok: true, repositoryRoot: repository, path: rel, ...(oldPath === rel ? {} : { oldPath }), layers }
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
