import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { Worker } from 'node:worker_threads'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-presentation'
import type {
  ReviewChecksResult, ReviewDiffResult, ReviewEntryKind, ReviewFileStatus, ReviewFileSummary, ReviewHistoryResult,
  ReviewLocation, ReviewManifestFile, ReviewManifestResult, ReviewPatchFile, ReviewPatchesResult, ReviewPatchLayer,
  ReviewPresentation, ReviewProbeResult, ReviewScope, ReviewSourceResult, ReviewSourceSide, ReviewWorkspaceKind,
  ReviewStatusResult, ReviewSummaryResult, ReviewTurnFile, ReviewTurnHistory, ReviewUndoTurnResult,
} from './types.ts'

export type {
  ReviewChecksResult, ReviewConsistency, ReviewDiffResult, ReviewEntryKind, ReviewFileStatus, ReviewFileSummary, ReviewHistoryResult,
  ReviewLineStatsState, ReviewLocation, ReviewManifestFile, ReviewManifestResult, ReviewPatchFile, ReviewPatchesResult,
  ReviewPatchLayer, ReviewPatchLayerV2, ReviewPresentation, ReviewProbeResult, ReviewScope, ReviewSourceResult, ReviewSourceSide,
  ReviewSourceSnapshot, ReviewStatusResult, ReviewSummaryResult, ReviewTurnFile, ReviewTurnFileState, ReviewTurnHistory,
  ReviewUndoTurnResult, ReviewWorkspaceKind,
} from './types.ts'

const exec = promisify(execFile)
const MAX_BUFFER = 16 * 1024 * 1024
const REF_ROOT = 'refs/deepcreator/turns'
const GIT_SCOPE_SNAPSHOT_TTL_MS = 5_000
const REVIEW_GENERATION_TTL_MS = 60_000
const REVIEW_GENERATION_LIMIT = 12
const EXACT_DIFF_TEXT_LIMIT = 1024 * 1024
const GENERATION_SOURCE_BYTES = 32 * 1024 * 1024
const GENERATION_CACHE_BYTES = 64 * 1024 * 1024
const AGGREGATE_PATCH_BATCH_THRESHOLD = 3
const DIFF_MODULE_PATH = createRequire(import.meta.url).resolve('diff')

interface ExactTurnFile {
  path: string
  before: string | null
  after: string
}

interface TurnDiffTracker {
  session: Session
  turn: number
  root: string
  inputCwd: string
  cwd: string
  files: Map<string, ExactTurnFile>
  dirty: boolean
  dirtyReason?: 'unknown-write' | 'invalid-result' | 'outside-workspace' | 'discontinuous-edit'
}

interface GenerationFile extends ReviewManifestFile {
  workspacePath: string
  workspaceOldPath?: string
}

interface ReviewGeneration {
  id: string
  sessionId: string
  epoch: number
  expires: number
  repository: ReviewRepository
  scope: ReviewScope
  location: ReviewLocation
  files: GenerationFile[]
  layerKind: ReviewPatchLayer['kind']
  oldRevision: ReviewPatchFile['layers'][number]['oldRevision']
  newRevision: ReviewPatchFile['layers'][number]['newRevision']
  startTree?: string
  endTree?: string
  /** Lazy authoritative tree construction; viewport demand starts it. */
  snapshot?: () => Promise<GitScopeSnapshot>
  exact?: Map<string, ExactTurnFile>
  /** Exact latest file texts from the current Turn, overlaid on a Git scope. */
  overlay?: Map<string, ExactTurnFile>
  patchCache?: Map<string, string>
  patchTasks?: Map<string, Promise<void>>
  patchBatchCount?: number
  aggregateTask?: Promise<void>
  aggregateTimer?: NodeJS.Timeout
  patchBytes?: number
  sourceCache?: Map<string, { text: string | null; bytes: number }>
  sourceTasks?: Map<string, Promise<string | null>>
  sourceBytes?: number
  catFile?: GitCatFileBatch
}

interface PorcelainFile {
  index: string
  workingTree: string
  path: string
  oldPath?: string
  submodule?: string
  headMode?: string
  indexMode?: string
  worktreeMode?: string
}
interface TurnRepository { path: string; head: string | null }
interface TurnManifestV1 {
  version: 1
  sessionId: string
  turn: number
  phase: 'start' | 'end'
  head: string | null
  files: ReviewTurnFile[]
}
interface TurnManifestV2 {
  version: 2
  sessionId: string
  turn: number
  phase: 'start' | 'end'
  repositories: TurnRepository[]
  inventory?: WorkspaceSnapshotFile[]
  files: ReviewTurnFile[]
}
type TurnManifest = TurnManifestV1 | TurnManifestV2
interface StoredTurn { ref: string; commit: string; tree: string; parent?: string; manifest: TurnManifest }
interface ReviewRepository {
  kind: ReviewWorkspaceKind
  /** Path exposed to the Client and used as the file-path boundary. */
  root: string
  /** Git object database root: the real repository or a DSH-owned bare repository. */
  repository: string
  /** Worktree used by filesystem snapshots; equal to root for both backends. */
  workspace: string
  /** POSIX path from the session's root repository/workspace to this repository. */
  location: string
}

declare module '@deepseek-ai/cordis' { interface Context { review: ReviewService } }
declare module '@ryanyujazz/dsh-presentation/types' { interface PresentationInputMap { review: { target?: string } } }

class ReviewBoundaryError extends Error {
  constructor(readonly code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE', message: string) { super(message) }
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function posixPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

function textLineCount(text: string | null): number {
  if (text === null || text === '') return 0
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

function patchStats(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) additions += 1
    else if (line.startsWith('-')) deletions += 1
  }
  return { additions, deletions }
}

async function exactPatchMapInWorker(files: readonly ExactTurnFile[]): Promise<Map<string, string>> {
  if (files.length === 0) return new Map()
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    import(workerData.diffUrl).then(({ createTwoFilesPatch }) => {
      let emitted = 0
      const rows = workerData.files.map(file => {
        if ((file.before?.length || 0) + file.after.length > workerData.textLimit) return [file.path, '']
        const started = performance.now()
        const patch = createTwoFilesPatch(file.path, file.path, file.before || '', file.after, '', '', { context: 3 })
        const complete = 'diff --git a/' + file.path + ' b/' + file.path + '\\n' + patch
        if (performance.now() - started > workerData.budget || emitted + Buffer.byteLength(complete) > workerData.aggregateLimit) return [file.path, '']
        emitted += Buffer.byteLength(complete)
        return [file.path, complete]
      })
      parentPort.postMessage(rows)
    }).catch(error => { throw error })
  `, {
    eval: true,
    workerData: { files, textLimit: EXACT_DIFF_TEXT_LIMIT, aggregateLimit: MAX_BUFFER, budget: 100, diffUrl: DIFF_MODULE_PATH },
  })
  return await new Promise<Map<string, string>>((resolvePromise, reject) => {
    worker.once('message', (rows: Array<[string, string]>) => { resolvePromise(new Map(rows)) })
    worker.once('error', reject)
    worker.once('exit', code => { if (code !== 0) reject(new Error(`Review diff worker exited with code ${String(code)}.`)) })
  })
}

function splitPatchBlocks(patch: string): string[] {
  if (patch === '') return []
  const starts: number[] = []
  const expression = /^diff --git /gm
  for (let match = expression.exec(patch); match !== null; match = expression.exec(patch)) starts.push(match.index)
  if (starts.length === 0) return [patch]
  return starts.map((start, index) => patch.slice(start, starts[index + 1] ?? patch.length).trimEnd())
}

function mapPatchBlocks(patch: string, files: readonly GenerationFile[]): Map<string, string> {
  const result = new Map<string, string>()
  const byNew = new Map(files.map(file => [file.workspacePath, file] as const))
  const byOld = new Map(files.map(file => [file.workspaceOldPath ?? file.workspacePath, file] as const))
  for (const block of splitPatchBlocks(patch)) {
    const newPath = /^\+\+\+ (?:b\/)?(.+)$/m.exec(block)?.[1]
      ?? /^rename to (.+)$/m.exec(block)?.[1]
    const oldPath = /^--- (?:a\/)?(.+)$/m.exec(block)?.[1]
      ?? /^rename from (.+)$/m.exec(block)?.[1]
    const file = (newPath === undefined || newPath === '/dev/null' ? undefined : byNew.get(newPath))
      ?? (oldPath === undefined || oldPath === '/dev/null' ? undefined : byOld.get(oldPath))
      ?? files.find(candidate => block.startsWith(`diff --git a/${candidate.workspaceOldPath ?? candidate.workspacePath} b/${candidate.workspacePath}`))
    if (file !== undefined) result.set(file.path, block)
  }
  return result
}

function statusCode(value: string | undefined): string {
  return value === undefined || value === '.' ? ' ' : value
}

function nativePath(path: string): string {
  return path.split('/').join(sep)
}

function manifestRepositories(manifest: TurnManifest): TurnRepository[] {
  return manifest.version === 2 ? manifest.repositories : [{ path: '', head: manifest.head }]
}

function filesystemRepositoryPath(session: Session): string {
  const id = String(session.id)
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error('Invalid session identity.')
  return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'deepcreator', 'review', id, 'repo.git')
}

async function repositoryFor(session: Session): Promise<ReviewRepository> {
  const cwd = session.header.cwd
  if (cwd === undefined) throw new ReviewBoundaryError('NO_WORKSPACE', 'This session has no workspace.')
  const workspace = await realpath(cwd)
  let stdout: string
  try {
    ({ stdout } = await exec('git', ['-C', workspace, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }))
    const repository = await realpath(stdout.trim())
    if (!isWithin(repository, workspace) && !isWithin(workspace, repository)) {
      throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Repository root is unrelated to the session workspace.')
    }
    return { kind: 'git', root: repository, repository, workspace: repository, location: '' }
  } catch (error) {
    if (error instanceof ReviewBoundaryError) throw error
  }
  const repository = filesystemRepositoryPath(session)
  await mkdir(resolve(repository, '..'), { recursive: true })
  try { await access(join(repository, 'HEAD')) }
  catch { await exec('git', ['init', '--bare', repository], { encoding: 'utf8', maxBuffer: MAX_BUFFER }) }
  return { kind: 'filesystem', root: workspace, repository: await realpath(repository), workspace, location: '' }
}

async function repositoryAt(root: ReviewRepository, location?: ReviewLocation): Promise<ReviewRepository> {
  const requested = posixPath(location?.repository ?? '')
  if (requested === '') return root
  const target = resolve(root.root, nativePath(requested))
  if (!isWithin(root.root, target)) throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Repository is outside the session workspace.')
  let top: string
  try { top = (await exec('git', ['-C', target, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', maxBuffer: MAX_BUFFER })).stdout.trim() }
  catch { throw new ReviewBoundaryError('NOT_REPOSITORY', 'The selected path is not an available Git repository.') }
  const canonical = await realpath(top)
  if (!isWithin(root.root, canonical)) throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Repository is outside the session workspace.')
  const canonicalLocation = posixPath(relative(root.root, canonical))
  if (canonicalLocation !== requested) throw new ReviewBoundaryError('NOT_REPOSITORY', 'The selected path is not a repository root.')
  return { kind: 'git', root: canonical, repository: canonical, workspace: canonical, location: canonicalLocation }
}

function boundaryFailure(error: unknown): { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string } {
  if (error instanceof ReviewBoundaryError) return { ok: false, code: error.code, message: error.message }
  return { ok: false, code: 'NOT_REPOSITORY', message: error instanceof Error ? error.message : String(error) }
}

function gitPrefix(repository: ReviewRepository): string[] {
  return repository.kind === 'git'
    ? ['-C', repository.repository]
    : [`--git-dir=${repository.repository}`, `--work-tree=${repository.workspace}`]
}

/** One generation-scoped `git cat-file --batch` process for lazy source reads. */
class GitCatFileBatch {
  private readonly child: ChildProcessWithoutNullStreams
  private buffer = Buffer.alloc(0)
  private waiters: Array<() => void> = []
  private failure: Error | null = null
  private tail: Promise<void> = Promise.resolve()

  constructor(repository: ReviewRepository) {
    this.child = spawn('git', [...gitPrefix(repository), 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk])
      this.wake()
    })
    this.child.stderr.resume()
    const fail = (reason: unknown) => {
      if (this.failure !== null) return
      this.failure = reason instanceof Error ? reason : new Error(String(reason))
      this.wake()
    }
    this.child.on('error', fail)
    this.child.on('close', code => { if (code !== 0) fail(new Error(`git cat-file exited with code ${String(code)}.`)) })
  }

  private wake(): void {
    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) waiter()
  }

  private async available(test: () => boolean): Promise<void> {
    while (!test()) {
      if (this.failure !== null) throw this.failure
      await new Promise<void>(resolvePromise => { this.waiters.push(resolvePromise) })
    }
  }

  private async line(): Promise<string> {
    await this.available(() => this.buffer.indexOf(10) >= 0)
    const newline = this.buffer.indexOf(10)
    const value = this.buffer.subarray(0, newline).toString('utf8')
    this.buffer = this.buffer.subarray(newline + 1)
    return value
  }

  private async bytes(length: number): Promise<Buffer> {
    await this.available(() => this.buffer.length >= length)
    const value = this.buffer.subarray(0, length)
    this.buffer = this.buffer.subarray(length)
    return value
  }

  private async query(object: string): Promise<string | null> {
    if (!this.child.stdin.write(`${object}\n`)) await new Promise<void>(resolvePromise => { this.child.stdin.once('drain', resolvePromise) })
    const header = await this.line()
    if (header.endsWith(' missing')) return null
    const size = Number(header.split(' ').at(-1))
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BUFFER) throw new Error('Invalid or oversized git cat-file response.')
    const content = await this.bytes(size)
    await this.bytes(1) // protocol newline after the object payload
    return content.toString('utf8')
  }

  read(tree: string, path: string): Promise<string | null> {
    let resolveResult!: (value: string | null) => void
    let rejectResult!: (reason: unknown) => void
    const result = new Promise<string | null>((resolvePromise, reject) => { resolveResult = resolvePromise; rejectResult = reject })
    this.tail = this.tail.then(async () => {
      try { resolveResult(await this.query(`${tree}:${path}`)) } catch (error) { rejectResult(error) }
    })
    return result
  }

  close(): void { this.child.kill() }
}

async function git(repository: ReviewRepository, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const { stdout } = await exec('git', [...gitPrefix(repository), ...args], {
    encoding: 'utf8', maxBuffer: MAX_BUFFER, ...(options.env === undefined ? {} : { env: options.env }),
  })
  return stdout
}

async function gitMaybe(repository: ReviewRepository, args: string[]): Promise<string | null> {
  try { return await git(repository, args) } catch { return null }
}

async function gitStdin(repository: ReviewRepository, args: string[], input: string, env?: NodeJS.ProcessEnv): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn('git', [...gitPrefix(repository), ...args], {
      env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let bytes = 0
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_BUFFER) { child.kill(); reject(new Error('Git output exceeded the Review buffer.')); return }
      stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString('utf8'))
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `Git exited with code ${String(code)}.`))
    })
    child.stdin.end(input)
  })
}

async function gitDiff(repository: ReviewRepository, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  try { return await git(repository, ['--literal-pathspecs', 'diff', ...args], options) }
  catch (error) {
    const failure = error as { code?: number; stdout?: string }
    if (failure.code === 1 && typeof failure.stdout === 'string') return failure.stdout
    throw error
  }
}

function parsePorcelainStatus(stdout: string): { branch: string; files: PorcelainFile[] } {
  const records = stdout.split('\0')
  let branch = ''
  const files: PorcelainFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record === '') continue
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length)
      branch = value === '(detached)' || value === '(initial)' ? '' : value
      continue
    }
    if (record.startsWith('? ')) {
      files.push({ index: '?', workingTree: '?', path: posixPath(record.slice(2)) })
      continue
    }
    if (record.startsWith('1 ')) {
      const match = /^1 (..) (\S+) (\S+) (\S+) (\S+) \S+ \S+ (.*)$/s.exec(record)
      if (match !== null) files.push({
        index: statusCode(match[1]?.[0]), workingTree: statusCode(match[1]?.[1]),
        ...(match[2] === undefined ? {} : { submodule: match[2] }),
        ...(match[3] === undefined ? {} : { headMode: match[3] }),
        ...(match[4] === undefined ? {} : { indexMode: match[4] }),
        ...(match[5] === undefined ? {} : { worktreeMode: match[5] }), path: posixPath(match[6] ?? ''),
      })
      continue
    }
    if (record.startsWith('2 ')) {
      const match = /^2 (..) (\S+) (\S+) (\S+) (\S+) \S+ \S+ \S+ (.*)$/s.exec(record)
      const previousPath = records[index + 1]
      if (match !== null && previousPath !== undefined && previousPath !== '') {
        files.push({
          index: statusCode(match[1]?.[0]), workingTree: statusCode(match[1]?.[1]),
          ...(match[2] === undefined ? {} : { submodule: match[2] }),
          ...(match[3] === undefined ? {} : { headMode: match[3] }),
          ...(match[4] === undefined ? {} : { indexMode: match[4] }),
          ...(match[5] === undefined ? {} : { worktreeMode: match[5] }), path: posixPath(match[6] ?? ''),
          oldPath: posixPath(previousPath),
        })
        index += 1
      }
      continue
    }
  }
  return { branch, files }
}

async function porcelainStatus(repository: ReviewRepository): Promise<{ branch: string; files: PorcelainFile[] }> {
  return parsePorcelainStatus(await git(repository, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']))
}

async function nestedRepositoryKind(repository: ReviewRepository, file: PorcelainFile): Promise<ReviewEntryKind | null> {
  if (file.headMode === '160000' || file.indexMode === '160000' || file.worktreeMode === '160000'
    || (file.submodule !== undefined && file.submodule !== 'N...')) return 'submodule'
  if (file.index !== '?' && file.workingTree !== '?') return null
  const target = resolve(repository.root, nativePath(file.path))
  try {
    const row = await lstat(target)
    if (!row.isDirectory()) return null
    const top = (await exec('git', ['-C', target, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', maxBuffer: MAX_BUFFER })).stdout.trim()
    return await realpath(top) === await realpath(target) ? 'repository' : null
  } catch { return null }
}

async function fileKind(repository: ReviewRepository, file: PorcelainFile): Promise<ReviewEntryKind> {
  const nested = await nestedRepositoryKind(repository, file)
  if (nested !== null) return nested
  try { return (await lstat(resolve(repository.root, nativePath(file.path)))).isSymbolicLink() ? 'symlink' : 'file' }
  catch { return 'file' }
}

async function statusPresentation(repository: ReviewRepository, file: PorcelainFile, kind: ReviewEntryKind): Promise<ReviewPresentation> {
  if (kind === 'repository' || kind === 'submodule') return kind
  if (file.oldPath !== undefined) return 'rename'
  if (file.index === 'T' || file.workingTree === 'T'
    || (file.headMode !== undefined && file.indexMode !== undefined && file.headMode !== '000000' && file.indexMode !== '000000' && file.headMode !== file.indexMode)
    || (file.indexMode !== undefined && file.worktreeMode !== undefined && file.indexMode !== '000000' && file.worktreeMode !== '000000' && file.indexMode !== file.worktreeMode)) return 'mode'
  const target = resolve(repository.root, nativePath(file.path))
  try { if ((await lstat(target)).size === 0) return 'empty' } catch { /* A deleted file is classified from its patch. */ }
  return 'unknown'
}

function patchPresentation(patch: string, hinted: ReviewPresentation, oldText: string | null, newText: string | null): ReviewPresentation {
  if (patch.includes('GIT binary patch') || patch.includes('Binary files ')) return 'binary'
  if (/^(?:similarity index|rename from|rename to) /m.test(patch)) return 'rename'
  if (/^(?:old mode|new mode) /m.test(patch)) return 'mode'
  if ((oldText === '' && newText === null) || (oldText === null && newText === '')) return 'empty'
  if (hinted !== 'unknown') return hinted
  return patch === '' ? 'unknown' : 'text'
}

async function publicStatusFiles(repository: ReviewRepository, files: PorcelainFile[]): Promise<ReviewFileStatus[]> {
  return await Promise.all(files.map(async file => {
    const kind = await fileKind(repository, file)
    const presentation = await statusPresentation(repository, file, kind)
    return {
      path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
      index: file.index, workingTree: file.workingTree, kind, presentation,
      ...(repository.location === '' ? {} : { repository: repository.location }),
    }
  }))
}

function parseNameStatus(stdout: string): ReviewTurnFile[] {
  const records = stdout.split('\0')
  const files: ReviewTurnFile[] = []
  for (let index = 0; index < records.length;) {
    const status = records[index++]
    if (status === undefined || status === '') continue
    const renamed = status.startsWith('R') || status.startsWith('C')
    const first = records[index++]
    if (first === undefined || first === '') continue
    if (renamed) {
      const second = records[index++]
      if (second !== undefined && second !== '') files.push({ oldPath: first, path: second, state: 'pending' })
    } else files.push({ path: first, state: 'pending' })
  }
  return files
}

interface Numstat { additions: number; deletions: number; binary: boolean }

function parseNumstat(stdout: string): Map<string, Numstat> {
  const records = stdout.split('\0')
  const stats = new Map<string, Numstat>()
  for (let index = 0; index < records.length;) {
    const header = records[index++]
    if (header === undefined || header === '') continue
    const match = /^([^\t]+)\t([^\t]+)\t(.*)$/s.exec(header)
    if (match === null) continue
    let path = match[3] ?? ''
    if (path === '') {
      // With -z, rename/copy rows put old and destination paths in their own
      // NUL records. Counts belong to the destination shown in Review.
      index += 1
      path = records[index++] ?? ''
    }
    if (path === '') continue
    const binary = match[1] === '-' || match[2] === '-'
    stats.set(path, {
      additions: /^\d+$/.test(match[1] ?? '') ? Number(match[1]) : 0,
      deletions: /^\d+$/.test(match[2] ?? '') ? Number(match[2]) : 0,
      binary,
    })
  }
  return stats
}

function attachNumstat(files: ReviewTurnFile[], stats: ReadonlyMap<string, Numstat>): ReviewTurnFile[] {
  return files.map(file => {
    if (file.additions !== undefined && file.deletions !== undefined) return file
    const measured = stats.get(file.path)
    if (measured === undefined) return { ...file, lineStatsState: 'unknown', presentation: file.presentation ?? 'unknown' }
    if (measured.binary) return { ...file, lineStatsState: 'not-applicable', presentation: 'binary' }
    if (measured.additions === 0 && measured.deletions === 0) {
      return { ...file, lineStatsState: 'not-applicable', presentation: file.oldPath === undefined ? 'unknown' : 'rename' }
    }
    return { ...file, additions: measured.additions, deletions: measured.deletions, lineStatsState: 'available', presentation: 'text' }
  })
}

async function enrichTurnPresentations(repository: ReviewRepository, startTree: string, endTree: string, files: ReviewTurnFile[]): Promise<ReviewTurnFile[]> {
  return await Promise.all(files.map(async file => {
    if (file.presentation !== 'unknown') return file
    const oldPath = file.oldPath ?? file.path
    const before = await treeText(repository, startTree, oldPath)
    const after = await treeText(repository, endTree, file.path)
    const patch = await gitDiff(repository, ['--find-renames', '--unified=0', startTree, endTree, '--', oldPath, file.path])
    return { ...file, presentation: patchPresentation(patch, 'unknown', before, after) }
  }))
}

function safeRef(session: Session, turn: number): string {
  const id = String(session.id)
  if (!/^[A-Za-z0-9._-]+$/.test(id) || !Number.isSafeInteger(turn) || turn < 0) throw new Error('Invalid session or turn identity.')
  return `${REF_ROOT}/${id}/${turn}`
}

async function head(repository: ReviewRepository): Promise<string | null> {
  if (repository.kind === 'filesystem') return null
  return (await gitMaybe(repository, ['rev-parse', '--verify', 'HEAD']))?.trim() || null
}

async function snapshotWorktree(repository: ReviewRepository, prepared?: {
  head: string | null
  nestedRepositories: readonly string[]
  changedPaths?: readonly string[]
}): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-index-'))
  const indexPath = join(temporary, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: indexPath }
  try {
    const currentHead = prepared === undefined ? await head(repository) : prepared.head
    if (repository.kind === 'filesystem' || currentHead === null) await git(repository, ['read-tree', '--empty'], { env })
    else await git(repository, ['read-tree', currentHead], { env })
    const paths = prepared?.changedPaths === undefined
      ? ['.']
      : [...new Set(prepared.changedPaths.filter(path => path !== ''))]
    if (repository.kind === 'git') {
      // Git ranges stop at repository boundaries. An unborn nested repository
      // cannot be staged as a gitlink and would otherwise make `git add -A`
      // fail the entire Review scope, so exclude every atomic nested root.
      const nestedRepositories = prepared?.nestedRepositories
      if (nestedRepositories !== undefined && prepared?.changedPaths === undefined) {
        for (const path of nestedRepositories) paths.push(`:(exclude)${path}`, `:(exclude)${path}/**`)
      } else {
        const status = await porcelainStatus(repository)
        for (const file of status.files) {
          if (await nestedRepositoryKind(repository, file) !== 'repository') continue
          paths.push(`:(exclude)${file.path}`, `:(exclude)${file.path}/**`)
        }
      }
    }
    if (repository.kind === 'filesystem') {
      const configuredHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
      const dshHome = await realpath(configuredHome).catch(() => configuredHome)
      // A workspace may be the user's home (or even DSH_HOME itself). Never
      // let the snapshot ingest its own persistent object database.
      const privateState = isWithin(repository.root, dshHome) && relative(repository.root, dshHome) !== ''
        ? dshHome
        : resolve(dshHome, 'deepcreator', 'review')
      if (isWithin(repository.root, privateState)) {
        const ignored = relative(repository.root, privateState).split(sep).join('/')
        if (ignored !== '') paths.push(`:(exclude)${ignored}`, `:(exclude)${ignored}/**`)
      }
    }
    // A live Git generation starts from HEAD and only overlays paths reported
    // by porcelain. This keeps tree construction proportional to the change
    // set instead of re-hashing every tracked file in a large workspace.
    if (paths.length > 0) await git(repository, ['add', '-A', '--', ...paths], { env })
    return (await git(repository, ['write-tree'], { env })).trim()
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function emptyTree(repository: ReviewRepository): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-empty-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
  try {
    await git(repository, ['read-tree', '--empty'], { env })
    return (await git(repository, ['write-tree'], { env })).trim()
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function indexTree(repository: ReviewRepository): Promise<string> {
  return (await git(repository, ['write-tree'])).trim()
}

interface WorkspaceSnapshotFile {
  path: string
  repository: string
  repositoryPath: string
  kind: 'file' | 'symlink'
}
interface WorkspaceSnapshot {
  tree: string
  files: Map<string, WorkspaceSnapshotFile>
  repositories: TurnRepository[]
}

type GitReviewScope = Exclude<ReviewScope, { turn: number }>

interface GitStatusSeed {
  head: string | null
  raw: { branch: string; files: PorcelainFile[] }
  selectedFiles: ReviewFileStatus[]
}

interface GitScopeSnapshot extends GitStatusSeed {
  baseline: string
  index: string
  live: string
  start: string
  end: string
}

interface GitScopeSnapshotEntry {
  seed: Promise<GitStatusSeed>
  full: () => Promise<GitScopeSnapshot>
  settled: boolean
  expires: number
}

interface ReconcileRepositoryState {
  repository: ReviewRepository
  head: string | null
  dirty: Set<string>
  fingerprint: string
}

interface ReconcileCacheEntry {
  commit: string
  signature: string
  value: StoredTurn | null
}

function selectedPorcelainFiles(files: readonly PorcelainFile[], scope: GitReviewScope): PorcelainFile[] {
  return files.filter(file => scope === 'uncommitted'
    || (scope === 'staged' ? file.index !== ' ' && file.index !== '?' : file.workingTree !== ' ' || file.index === '?'))
}

async function gitStatusSeed(repository: ReviewRepository, scope: GitReviewScope): Promise<GitStatusSeed> {
  const currentHead = await head(repository)
  const raw = await porcelainStatus(repository)
  const selectedFiles = await publicStatusFiles(repository, selectedPorcelainFiles(raw.files, scope))
  return {
    head: currentHead,
    raw,
    selectedFiles,
  }
}

async function completeGitScopeSnapshot(repository: ReviewRepository, scope: GitReviewScope, seed: GitStatusSeed): Promise<GitScopeSnapshot> {
  const baseline = seed.head ?? await emptyTree(repository)
  const index = await indexTree(repository)
  const nestedRepositories = scope === 'staged'
    ? []
    : (await Promise.all(seed.raw.files.map(async file => await nestedRepositoryKind(repository, file) === 'repository'
        ? file.path
        : null)))
      .filter((path): path is string => path !== null)
  const live = scope === 'staged'
    ? index
    : await snapshotWorktree(repository, {
        head: seed.head,
        nestedRepositories,
        changedPaths: seed.raw.files.flatMap(file => file.oldPath === undefined ? [file.path] : [file.oldPath, file.path]),
      })
  return {
    ...seed,
    baseline,
    index,
    live,
    start: scope === 'unstaged' ? index : baseline,
    end: scope === 'staged' ? index : live,
  }
}

async function childRepository(nativeRoot: string, location: string): Promise<ReviewRepository | null> {
  try {
    const top = (await exec('git', ['-C', nativeRoot, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', maxBuffer: MAX_BUFFER })).stdout.trim()
    if (await realpath(top) !== await realpath(nativeRoot)) return null
    return { kind: 'git', root: nativeRoot, repository: nativeRoot, workspace: nativeRoot, location }
  } catch { return null }
}

async function repositoryFiles(repository: ReviewRepository): Promise<{ files: WorkspaceSnapshotFile[]; children: Array<{ path: string; kind: 'repository' | 'submodule' }> }> {
  const children = new Map<string, 'repository' | 'submodule'>()
  if (repository.kind === 'git') {
    const rows = await porcelainStatus(repository)
    for (const row of rows.files) {
      const kind = await nestedRepositoryKind(repository, row)
      if (kind === 'repository' || kind === 'submodule') children.set(row.path, kind)
    }
    const staged = await git(repository, ['ls-files', '--stage', '-z'])
    for (const record of staged.split('\0')) {
      const match = /^160000 \S+ \d+\t(.*)$/s.exec(record)
      if (match?.[1] !== undefined) children.set(posixPath(match[1]), 'submodule')
    }
  }
  const listed = (await git(repository, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(Boolean)
  if (repository.kind === 'filesystem') {
    for (const raw of listed) {
      const path = posixPath(raw)
      const marker = path.indexOf('/.git/')
      if (marker > 0) children.set(path.slice(0, marker), 'repository')
      else if (path.endsWith('/.git')) children.set(path.slice(0, -5), 'repository')
      else {
        try {
          if ((await lstat(resolve(repository.root, nativePath(path)))).isDirectory()
            && await childRepository(resolve(repository.root, nativePath(path)), path) !== null) children.set(path, 'repository')
        } catch { /* Ordinary file or a directory racing removal. */ }
      }
    }
  }
  const files: WorkspaceSnapshotFile[] = []
  let privatePrefix: string | null = null
  if (repository.kind === 'filesystem') {
    const configuredHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
    const persistent = resolve(configuredHome, 'deepcreator', 'review')
    if (isWithin(repository.root, persistent)) privatePrefix = posixPath(relative(repository.root, persistent))
    if (isWithin(repository.root, repository.repository)) {
      const ownObjectDatabase = posixPath(relative(repository.root, repository.repository))
      if (ownObjectDatabase !== '') privatePrefix = ownObjectDatabase
    }
  }
  for (const raw of listed) {
    const path = posixPath(raw)
    if (path === '' || path.split('/').includes('.git')) continue
    if (privatePrefix !== null && (path === privatePrefix || path.startsWith(`${privatePrefix}/`))) continue
    if ([...children.keys()].some(child => path === child || path.startsWith(`${child}/`))) continue
    const target = resolve(repository.root, nativePath(path))
    try {
      const info = await lstat(target)
      if (!info.isFile() && !info.isSymbolicLink()) continue
      const workspacePath = posixPath([repository.location, path].filter(Boolean).join('/'))
      files.push({ path: workspacePath, repository: repository.location, repositoryPath: path, kind: info.isSymbolicLink() ? 'symlink' : 'file' })
    } catch { /* A path may disappear while the turn boundary is captured. */ }
  }
  return { files, children: [...children].map(([path, kind]) => ({ path, kind })) }
}

async function hashWorkspaceFiles(root: ReviewRepository, files: readonly WorkspaceSnapshotFile[]): Promise<Map<string, { mode: string; object: string }>> {
  const result = new Map<string, { mode: string; object: string }>()
  const regular: Array<{ file: WorkspaceSnapshotFile; target: string; mode: string }> = []
  for (const file of files) {
    const target = resolve(root.root, nativePath(file.path))
    try {
      const info = await lstat(target)
      if (info.isSymbolicLink()) {
        const object = (await gitStdin(root, ['hash-object', '-w', '--stdin'], await readlink(target))).trim()
        result.set(file.path, { mode: '120000', object })
      } else if (info.isFile()) {
        const mode = (info.mode & 0o111) === 0 ? '100644' : '100755'
        // `--stdin-paths` is newline-delimited. Preserve the rare newline path
        // through the single-file fallback instead of mis-hashing it.
        if (target.includes('\n')) {
          result.set(file.path, { mode, object: (await git(root, ['hash-object', '-w', '--no-filters', target])).trim() })
        } else regular.push({ file, target, mode })
      }
    } catch { /* A path may disappear while the snapshot is being written. */ }
  }
  const BATCH = 512
  for (let offset = 0; offset < regular.length; offset += BATCH) {
    const batch = regular.slice(offset, offset + BATCH)
    const output = await gitStdin(root, ['hash-object', '-w', '--no-filters', '--stdin-paths'], `${batch.map(item => item.target).join('\n')}\n`)
    const objects = output.trim().split('\n')
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index]
      const object = objects[index]
      if (item !== undefined && object !== undefined && object !== '') result.set(item.file.path, { mode: item.mode, object })
    }
  }
  return result
}

/**
 * Capture the session workspace rather than one Git boundary. Each repository
 * contributes tracked and non-ignored untracked files, while nested Git
 * metadata remains outside the synthetic tree.
 */
async function snapshotWorkspace(root: ReviewRepository): Promise<WorkspaceSnapshot> {
  const queue: ReviewRepository[] = [root]
  const seen = new Set<string>()
  const files = new Map<string, WorkspaceSnapshotFile>()
  const repositories: TurnRepository[] = []
  while (queue.length > 0) {
    const repository = queue.shift()
    if (repository === undefined || seen.has(repository.location)) continue
    seen.add(repository.location)
    repositories.push({ path: repository.location, head: await head(repository) })
    let listed: Awaited<ReturnType<typeof repositoryFiles>>
    try { listed = await repositoryFiles(repository) }
    catch (error) {
      // A nested repository/submodule may disappear or become unavailable
      // during capture. Preserve every other repository instead of dropping
      // the whole Turn boundary.
      if (repository.location !== '') continue
      throw error
    }
    for (const file of listed.files) files.set(file.path, file)
    for (const child of listed.children) {
      const location = posixPath([repository.location, child.path].filter(Boolean).join('/'))
      const nested = await childRepository(resolve(repository.root, nativePath(child.path)), location)
      if (nested !== null) queue.push(nested)
    }
  }
  // The filesystem backend's object database may itself live below the
  // workspace (for example when DSH_HOME is redirected into a test/project).
  // Filter it at the aggregate boundary as well as during enumeration,
  // because writing later blobs mutates that directory while we capture.
  if (root.kind === 'filesystem' && isWithin(root.root, root.repository)) {
    const privateDatabase = posixPath(relative(root.root, root.repository))
    for (const path of files.keys()) {
      if (path === privateDatabase || path.startsWith(`${privateDatabase}/`)) files.delete(path)
    }
  }
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-workspace-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
  try {
    await git(root, ['read-tree', '--empty'], { env })
    const hashed = await hashWorkspaceFiles(root, [...files.values()])
    for (const path of files.keys()) if (!hashed.has(path)) files.delete(path)
    if (hashed.size > 0) {
      const indexInfo = [...hashed].map(([path, row]) => `${row.mode} ${row.object}\t${path}\0`).join('')
      await gitStdin(root, ['update-index', '-z', '--index-info'], indexInfo, env)
    }
    return { tree: (await git(root, ['write-tree'], { env })).trim(), files, repositories }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function rootRepositoryTree(repository: ReviewRepository, tree: string, manifests: readonly TurnRepository[]): Promise<string> {
  const children = manifests.map(item => item.path).filter(Boolean)
  if (children.length === 0) return tree
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-root-tree-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
  try {
    await git(repository, ['read-tree', tree], { env })
    await git(repository, ['rm', '--cached', '-r', '--ignore-unmatch', '--', ...children], { env })
    return (await git(repository, ['write-tree'], { env })).trim()
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function preserveUnavailableRepositories(
  repository: ReviewRepository, snapshot: WorkspaceSnapshot, startTree: string, previous: readonly TurnRepository[],
): Promise<WorkspaceSnapshot> {
  const missing: Array<{ path: string; tree: string }> = []
  for (const item of previous) {
    if (item.path === '' || snapshot.repositories.some(current => current.path === item.path)) continue
    try {
      const info = await lstat(resolve(repository.root, nativePath(item.path)))
      if (!info.isDirectory()) continue
      const tree = (await gitMaybe(repository, ['rev-parse', `${startTree}:${item.path}`]))?.trim()
      if (tree !== undefined && tree !== null && tree !== '') missing.push({ path: item.path, tree })
    } catch { /* A removed repository is a real workspace deletion. */ }
  }
  if (missing.length === 0) return snapshot
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-preserve-index-'))
  const env = { ...process.env, GIT_INDEX_FILE: join(temporary, 'index') }
  try {
    await git(repository, ['read-tree', snapshot.tree], { env })
    for (const item of missing) await git(repository, ['read-tree', `--prefix=${item.path}/`, item.tree], { env })
    return { ...snapshot, tree: (await git(repository, ['write-tree'], { env })).trim() }
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function partialReverseTree(repository: ReviewRepository, startTree: string, endTree: string, paths: string[], baseEnv?: NodeJS.ProcessEnv): Promise<string> {
  const patch = await gitDiff(repository, ['--binary', '--full-index', startTree, endTree, '--', ...paths], baseEnv === undefined ? {} : { env: baseEnv })
  if (patch === '') return endTree
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-reverse-index-'))
  const indexPath = join(temporary, 'index')
  const patchPath = join(temporary, 'turn.patch')
  const env = { ...process.env, ...baseEnv, GIT_INDEX_FILE: indexPath }
  try {
    await writeFile(patchPath, patch)
    await git(repository, ['read-tree', endTree], { env })
    await git(repository, ['apply', '--cached', '--reverse', '--3way', patchPath], { env })
    return (await git(repository, ['write-tree'], { env })).trim()
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function mergeTrees(repository: ReviewRepository, base: string, current: string, target: string, env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const output = await git(repository, ['merge-tree', '--write-tree', '--merge-base', base, current, target], env === undefined ? {} : { env })
    const tree = output.trim().split('\n')[0]
    return tree !== undefined && /^[0-9a-f]{40,64}$/.test(tree) ? tree : null
  } catch { return null }
}

function commitEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'DeepCreator', GIT_AUTHOR_EMAIL: 'deepcreator@local',
    GIT_COMMITTER_NAME: 'DeepCreator', GIT_COMMITTER_EMAIL: 'deepcreator@local',
  }
}

async function writeTurn(repository: ReviewRepository, ref: string, tree: string, manifest: TurnManifest, parent?: string): Promise<string> {
  const args = ['commit-tree', tree, '-F', '-']
  if (parent !== undefined) args.push('-p', parent)
  // The manifest grows with every file changed in the turn and can exceed the
  // OS command line length; pipe it through stdin instead of `-m`.
  const commit = (await gitStdin(repository, args, `${JSON.stringify(manifest)}\n`, commitEnvironment())).trim()
  await git(repository, ['update-ref', ref, commit])
  return commit
}

function isManifest(value: unknown): value is TurnManifest {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Partial<TurnManifest>
  return (row.version === 1 || row.version === 2) && typeof row.sessionId === 'string' && Number.isSafeInteger(row.turn)
    && (row.phase === 'start' || row.phase === 'end') && Array.isArray(row.files)
}

async function readTurn(repository: ReviewRepository, ref: string): Promise<StoredTurn | null> {
  const commit = (await gitMaybe(repository, ['rev-parse', '--verify', ref]))?.trim()
  if (commit === undefined || commit === null || commit === '') return null
  const raw = await git(repository, ['cat-file', '-p', commit])
  const split = raw.indexOf('\n\n')
  if (split < 0) return null
  const headers = raw.slice(0, split).split('\n')
  const tree = headers.find(line => line.startsWith('tree '))?.slice(5)
  const parent = headers.find(line => line.startsWith('parent '))?.slice(7)
  if (tree === undefined) return null
  let decoded: unknown
  try { decoded = JSON.parse(raw.slice(split + 2).trim()) } catch { return null }
  return isManifest(decoded) ? { ref, commit, tree, ...(parent === undefined ? {} : { parent }), manifest: decoded } : null
}

async function treeText(repository: ReviewRepository, tree: string, path: string): Promise<string | null> {
  return await gitMaybe(repository, ['show', `${tree}:${path}`])
}

function turnState(files: readonly ReviewTurnFile[]): ReviewTurnHistory['state'] {
  const states = new Set(files.map(file => file.state))
  if (states.size > 1) return 'mixed'
  const state = files[0]?.state
  return state === 'pending' || state === undefined ? 'active' : state
}

/** Host repository review and turn-snapshot service (`ctx.review`). */
export class ReviewService extends TypertRemoteService {
  static inject = ['sessions', 'presentationRuntime']
  private pendingSnapshots = new Map<string, Promise<void>>()
  /** One UI refresh fans out to history/status/summary/diff; share its live tree. */
  private liveSnapshots = new Map<string, { expires: number; value: StoredTurn | null }>()
  /** One Git-scope refresh shares porcelain, index and worktree trees across summary/diff requests. */
  private gitScopeSnapshots = new Map<string, GitScopeSnapshotEntry>()
  /** Reconciliation is pure for one retained Turn commit plus current HEAD/status fingerprints. */
  private reconcileCache = new Map<string, ReconcileCacheEntry>()
  /** Ephemeral Codex-style exact delta projection for currently open Turns. */
  private turnTrackers = new Map<string, TurnDiffTracker>()
  private rootCallTurns = new Map<string, number>()
  private sessionEpochs = new Map<string, number>()
  private generations = new Map<string, ReviewGeneration>()
  private watchers = new Map<string, { root: string; watcher: FSWatcher }>()
  private generationSerial = 0

  constructor(ctx: Context) {
    super(ctx, 'review')
    const presentation = ctx.presentationRuntime
    if (presentation !== undefined) {
      const disposePresentation = presentation.registerResolver({
        kind: 'review', description: 'Present the repository review, optionally focused on a target. Fields: kind="review", optional target.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {
          kind: { type: 'string', const: 'review', required: true }, target: { type: 'string' },
        } },
        parse: input => {
          const value = input as Record<string, unknown>
          if (value.kind !== 'review' || (value.target !== undefined && typeof value.target !== 'string')) throw new Error('review presentation accepts an optional string target.')
          return { kind: 'review' as const, ...(value.target === undefined ? {} : { target: value.target }) }
        },
        materialize: async (_context, input) => ({ kind: 'review', id: input.target ?? 'home', mode: 'none' }),
      })
      ctx.effect(() => disposePresentation, 'review: presentation resolver')
    }
    ctx.on('agent/pre-step', async ({ agent, turn, step }: { agent: Agent; turn: number; step: number }, next) => {
      if (step === 1) {
        await this.captureStart(agent.session, turn)
        await this.ensureTracker(agent.session, turn)
      }
      return next()
    })
    ctx.on('agent/turn-stopping', async ({ agent, turn }: { agent: Agent; turn: number }) => {
      await this.captureEnd(agent.session, turn)
    })
    ctx.on('session/event', (session, event) => {
      this.invalidateLiveSnapshots(session)
      if (event.type === 'tool/call') {
        this.rootCallTurns.set(`${String(session.id)}\0${String(event.data.callId)}`, event.data.turn)
      }
      if (event.type === 'turn/end') void this.captureEnd(session, event.data.turn)
    })
    ctx.on('tools/result', (execution, result) => { this.observeToolResult(execution, result) })
  }

  private trackerKey(session: Session, turn: number): string {
    return `${String(session.id)}\0${String(turn)}`
  }

  private latestExactTracker(session: Session): TurnDiffTracker | undefined {
    let latest: TurnDiffTracker | undefined
    for (const tracker of this.turnTrackers.values()) {
      if (String(tracker.session.id) !== String(session.id) || tracker.dirty) continue
      if (latest === undefined || tracker.turn > latest.turn) latest = tracker
    }
    return latest
  }

  private epoch(session: Session): number {
    return this.sessionEpochs.get(String(session.id)) ?? 0
  }

  private bumpEpoch(session: Session): number {
    const id = String(session.id)
    const epoch = (this.sessionEpochs.get(id) ?? 0) + 1
    this.sessionEpochs.set(id, epoch)
    this.invalidateStableCaches(session)
    return epoch
  }

  private async ensureTracker(session: Session, turn: number): Promise<TurnDiffTracker | null> {
    const key = this.trackerKey(session, turn)
    const existing = this.turnTrackers.get(key)
    if (existing !== undefined) return existing
    try {
      const repository = await repositoryFor(session)
      this.ensureWatcher(session, repository.root)
      const configuredCwd = resolve(session.header.cwd ?? repository.root)
      const cwd = await realpath(configuredCwd).catch(() => configuredCwd)
      const tracker: TurnDiffTracker = { session, turn, root: repository.root, inputCwd: configuredCwd, cwd, files: new Map(), dirty: false }
      this.turnTrackers.set(key, tracker)
      return tracker
    } catch { return null }
  }

  private ensureWatcher(session: Session, root: string): void {
    const id = String(session.id)
    const existing = this.watchers.get(id)
    if (existing?.root === root) return
    existing?.watcher.close()
    try {
      const watcher = watch(root, { recursive: true }, (_event, filename) => {
        const path = filename?.toString().replaceAll('\\', '/') ?? ''
        if (path === '.git' || path.startsWith('.git/')) return
        this.bumpEpoch(session)
      })
      watcher.unref()
      watcher.on('error', () => {
        if (this.watchers.get(id)?.watcher === watcher) this.watchers.delete(id)
        watcher.close()
      })
      this.watchers.set(id, { root, watcher })
    } catch {
      // Focus/visibility/manual refresh remains the documented fallback on
      // platforms whose fs.watch implementation cannot recurse.
    }
  }

  private toolResultValue(result: Readonly<ToolExecutionResult>): { path: string; before: string | null; after: string } | null {
    if (result.isError || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value)) return null
    const value = result.value as Record<string, unknown>
    if (typeof value.path !== 'string' || typeof value.after !== 'string'
      || value.before !== null && typeof value.before !== 'string') return null
    return { path: value.path, before: value.before as string | null, after: value.after }
  }

  private observeToolResult(execution: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): void {
    const agent = execution.agent
    if (agent === undefined) return
    const session = agent.session
    const turn = this.rootCallTurns.get(`${String(session.id)}\0${String(execution.rootCallId)}`)
    if (turn === undefined) return
    const tracker = this.turnTrackers.get(this.trackerKey(session, turn))
    if (tracker === undefined) return
    if (execution.name === 'bash') {
      tracker.dirty = true
      tracker.dirtyReason = 'unknown-write'
      this.bumpEpoch(session)
      return
    }
    if (execution.name !== 'write' && execution.name !== 'edit') return
    const value = this.toolResultValue(result)
    if (value === null) {
      tracker.dirty = true
      tracker.dirtyReason = 'invalid-result'
      this.bumpEpoch(session)
      return
    }
    const inputTarget = isAbsolute(value.path) ? resolve(value.path) : resolve(tracker.inputCwd, nativePath(value.path))
    const target = isWithin(tracker.inputCwd, inputTarget)
      ? resolve(tracker.cwd, relative(tracker.inputCwd, inputTarget))
      : inputTarget
    if (!isWithin(tracker.root, target)) {
      tracker.dirty = true
      tracker.dirtyReason = 'outside-workspace'
      this.bumpEpoch(session)
      return
    }
    const path = posixPath(relative(tracker.root, target))
    const existing = tracker.files.get(path)
    if (existing !== undefined && existing.after !== value.before) {
      tracker.dirty = true
      tracker.dirtyReason = 'discontinuous-edit'
      this.bumpEpoch(session)
      return
    }
    const next: ExactTurnFile = { path, before: existing?.before ?? value.before, after: value.after }
    if (next.before === next.after) tracker.files.delete(path)
    else tracker.files.set(path, next)
    this.bumpEpoch(session)
  }

  private invalidateLiveSnapshots(session: Session): void {
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    for (const ref of this.liveSnapshots.keys()) if (ref.startsWith(prefix)) this.liveSnapshots.delete(ref)
  }

  private invalidateStableCaches(session: Session): void {
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    for (const ref of this.reconcileCache.keys()) if (ref.startsWith(prefix)) this.reconcileCache.delete(ref)
    const scopePrefix = `${String(session.id)}\0`
    for (const key of this.gitScopeSnapshots.keys()) if (key.startsWith(scopePrefix)) this.gitScopeSnapshots.delete(key)
  }

  private gitScopeSnapshot(
    session: Session,
    repository: ReviewRepository,
    scope: GitReviewScope,
    refresh: boolean,
  ): GitScopeSnapshotEntry {
    const key = `${String(session.id)}\0${repository.repository}\0${scope}`
    const now = Date.now()
    const cached = this.gitScopeSnapshots.get(key)
    if (cached !== undefined && (!cached.settled || (!refresh && cached.expires > now))) {
      // Keep one sequential prefetch wave on the same captured tree even when
      // a slow platform needs more than one fixed TTL to load every file.
      if (!refresh && cached.settled) cached.expires = now + GIT_SCOPE_SNAPSHOT_TTL_MS
      return cached
    }

    const seed = gitStatusSeed(repository, scope)
    let full: Promise<GitScopeSnapshot> | undefined
    const entry: GitScopeSnapshotEntry = {
      seed,
      full: () => {
        if (full !== undefined) return full
        entry.settled = false
        entry.expires = Number.POSITIVE_INFINITY
        full = seed.then(async value => await completeGitScopeSnapshot(repository, scope, value))
        void full.then(
          () => {
            entry.settled = true
            entry.expires = Date.now() + GIT_SCOPE_SNAPSHOT_TTL_MS
          },
          () => {
            entry.settled = true
            entry.expires = 0
            if (this.gitScopeSnapshots.get(key) === entry) this.gitScopeSnapshots.delete(key)
          },
        )
        return full
      },
      settled: false,
      expires: Number.POSITIVE_INFINITY,
    }
    this.gitScopeSnapshots.set(key, entry)
    void seed.then(
      () => {
        if (full === undefined) {
          entry.settled = true
          entry.expires = Date.now() + GIT_SCOPE_SNAPSHOT_TTL_MS
        }
      },
      () => {
        entry.settled = true
        entry.expires = 0
        if (this.gitScopeSnapshots.get(key) === entry) this.gitScopeSnapshots.delete(key)
      },
    )
    return entry
  }

  private enqueue(key: string, task: () => Promise<void>): Promise<void> {
    const previous = this.pendingSnapshots.get(key) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(task).finally(() => {
      if (this.pendingSnapshots.get(key) === current) this.pendingSnapshots.delete(key)
    })
    this.pendingSnapshots.set(key, current)
    return current
  }

  private async captureStart(session: Session, turn: number): Promise<void> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch { return }
    const ref = safeRef(session, turn)
    await this.enqueue(ref, async () => {
      if (await readTurn(repository, ref) !== null) return
      const snapshot = await snapshotWorkspace(repository)
      await writeTurn(repository, ref, snapshot.tree, {
        version: 2, sessionId: String(session.id), turn, phase: 'start', repositories: snapshot.repositories,
        inventory: [...snapshot.files.values()], files: [],
      })
    })
  }

  private async captureEnd(session: Session, turn: number): Promise<void> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch { return }
    const ref = safeRef(session, turn)
    await this.enqueue(ref, async () => {
      let start = await readTurn(repository, ref)
      if (start?.manifest.phase === 'end') return
      if (start === null) {
        const snapshot = await snapshotWorkspace(repository)
        const commit = await writeTurn(repository, ref, snapshot.tree, {
          version: 2, sessionId: String(session.id), turn, phase: 'start', repositories: snapshot.repositories,
          inventory: [...snapshot.files.values()], files: [],
        })
        start = await readTurn(repository, ref)
        if (start === null || start.commit !== commit) return
      }
      let end = await snapshotWorkspace(repository)
      end = await preserveUnavailableRepositories(repository, end, start.tree, manifestRepositories(start.manifest))
      const endTree = end.tree
      const files = parseNameStatus(await gitDiff(repository, ['--name-status', '-z', '--find-renames', start.tree, endTree]))
      if (files.length === 0) {
        await git(repository, ['update-ref', '-d', ref])
        return
      }
      const stats = parseNumstat(await gitDiff(repository, ['--numstat', '-z', '--find-renames', start.tree, endTree]))
      const measured = await enrichTurnPresentations(repository, start.tree, endTree, attachNumstat(files.map(file => {
        const startInventory = start.manifest.version === 2 ? start.manifest.inventory ?? [] : []
        const owner = end.files.get(file.path)
          ?? (file.oldPath === undefined ? undefined : end.files.get(file.oldPath))
          ?? startInventory.find(item => item.path === (file.oldPath ?? file.path))
        return owner === undefined ? file : {
          ...file, repository: owner.repository, repositoryPath: owner.repositoryPath, kind: owner.kind,
        }
      }), stats))
      await writeTurn(repository, ref, endTree, {
        // Keep the start boundary's HEAD as the first reconciliation base so
        // a commit created inside this turn is recognized immediately.
        version: 2, sessionId: String(session.id), turn, phase: 'end', repositories: manifestRepositories(start.manifest), files: measured,
      }, start.commit)
      const completed = await readTurn(repository, ref)
      if (completed !== null && repository.kind === 'git') await this.reconcile(repository, completed)
    })
    this.turnTrackers.delete(this.trackerKey(session, turn))
    const prefix = `${String(session.id)}\0`
    for (const [key, ownerTurn] of this.rootCallTurns) {
      if (key.startsWith(prefix) && ownerTurn === turn) this.rootCallTurns.delete(key)
    }
    this.bumpEpoch(session)
  }

  private async storedTurns(session: Session, repository: ReviewRepository): Promise<StoredTurn[]> {
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    const refs = (await gitMaybe(repository, ['for-each-ref', '--format=%(refname)', prefix]))?.trim().split('\n').filter(Boolean) ?? []
    const turns = (await Promise.all(refs.map(ref => readTurn(repository, ref))))
      .filter((turn): turn is StoredTurn => turn !== null)
    const retained = new Set(turns.map(turn => turn.ref))
    for (const ref of this.reconcileCache.keys()) {
      if (ref.startsWith(prefix) && !retained.has(ref)) this.reconcileCache.delete(ref)
    }
    turns.sort((left, right) => right.manifest.turn - left.manifest.turn)
    return turns
  }

  private async reconciliationStates(repository: ReviewRepository, turns: readonly StoredTurn[]): Promise<Map<string, ReconcileRepositoryState>> {
    const paths = new Set(turns.flatMap(turn => manifestRepositories(turn.manifest).map(item => item.path)))
    const rows = await Promise.all([...paths].map(async path => {
      const current = path === '' ? repository : await childRepository(resolve(repository.root, nativePath(path)), path)
      if (current === null) return null
      const currentHead = await head(current)
      const status = await porcelainStatus(current)
      const dirty = new Set(status.files.flatMap(file => [file.path, ...(file.oldPath === undefined ? [] : [file.oldPath])]))
      return [path, {
        repository: current,
        head: currentHead,
        dirty,
        fingerprint: JSON.stringify([currentHead, status.files]),
      }] as const
    }))
    return new Map(rows.filter((row): row is NonNullable<typeof row> => row !== null))
  }

  /** Remove every private snapshot ref owned by a deleted session. */
  async deleteSessionSnapshots(session: Session): Promise<void> {
    this.invalidateLiveSnapshots(session)
    this.invalidateStableCaches(session)
    const sessionId = String(session.id)
    for (const [key, tracker] of this.turnTrackers) if (String(tracker.session.id) === sessionId) this.turnTrackers.delete(key)
    for (const [key, generation] of this.generations) if (generation.sessionId === sessionId) this.dropGeneration(key)
    for (const key of this.rootCallTurns.keys()) if (key.startsWith(`${sessionId}\0`)) this.rootCallTurns.delete(key)
    this.sessionEpochs.delete(sessionId)
    this.watchers.get(sessionId)?.watcher.close()
    this.watchers.delete(sessionId)
    const repository = await repositoryFor(session)
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    const refs = (await gitMaybe(repository, ['for-each-ref', '--format=%(refname)', prefix]))?.trim().split('\n').filter(Boolean) ?? []
    for (const ref of refs) await git(repository, ['update-ref', '-d', ref])
    await rm(resolve(filesystemRepositoryPath(session), '..'), { recursive: true, force: true })
  }

  private async reconcile(
    repository: ReviewRepository,
    input: StoredTurn,
    preparedStates?: ReadonlyMap<string, ReconcileRepositoryState>,
  ): Promise<StoredTurn | null> {
    if (repository.kind === 'filesystem') return input
    let stored = input
    if (stored.parent !== undefined && stored.manifest.files.some(file => file.additions === undefined || file.deletions === undefined)) {
      // Active refs from versions before line-count persistence still retain
      // both boundary trees. Backfill them once so existing conversations get
      // accurate cards without waiting for another turn.
      const startTree = (await git(repository, ['show', '-s', '--format=%T', stored.parent])).trim()
      const stats = parseNumstat(await gitDiff(repository, ['--numstat', '-z', '--find-renames', startTree, stored.tree]))
      const manifest = { ...stored.manifest, files: attachNumstat(stored.manifest.files, stats) }
      const commit = await writeTurn(repository, stored.ref, stored.tree, manifest, stored.parent)
      stored = { ...stored, commit, manifest }
    }
    if (stored.parent === undefined) {
      if (stored.manifest.files.every(file => file.state === 'committed')) {
        await git(repository, ['update-ref', '-d', stored.ref])
        return null
      }
      return stored
    }
    const currentStates = preparedStates ?? await this.reconciliationStates(repository, [stored])
    const signature = manifestRepositories(stored.manifest)
      .map(item => `${item.path}\0${currentStates.get(item.path)?.fingerprint ?? 'unavailable'}`).join('\0')
    const cached = this.reconcileCache.get(stored.ref)
    if (cached !== undefined && cached.commit === stored.commit && cached.signature === signature) return cached.value
    const remember = (value: StoredTurn | null): StoredTurn | null => {
      this.reconcileCache.set(stored.ref, { commit: value?.commit ?? stored.commit, signature, value })
      return value
    }
    const currentHead = currentStates.get('')?.head ?? await head(repository)
    const repositoryRows = new Map<string, {
      repository: ReviewRepository
      head: string | null
      headChanged: boolean
      fastForward: boolean
      changed: Set<string>
      dirty: Set<string>
    }>()
    for (const baseline of manifestRepositories(stored.manifest)) {
      const current = currentStates.get(baseline.path)
      if (current === undefined) continue
      const child = current.repository
      const nextHead = current.head
      const headChanged = baseline.head !== nextHead
      const fastForward = baseline.head === null
        ? nextHead !== null
        : nextHead !== null && await gitMaybe(child, ['merge-base', '--is-ancestor', baseline.head, nextHead]) !== null
      const changed = new Set<string>()
      if (headChanged && nextHead !== null) {
        const base = baseline.head ?? await emptyTree(child)
        const names = await gitDiff(child, ['--name-only', '-z', base, nextHead])
        for (const name of names.split('\0')) if (name !== '') changed.add(posixPath(name))
      }
      repositoryRows.set(baseline.path, {
        repository: child, head: nextHead, headChanged, fastForward, changed,
        dirty: current.dirty,
      })
    }
    let moved = false
    const files: ReviewTurnFile[] = []
    for (const file of stored.manifest.files) {
      if (file.state === 'reverted') { files.push(file); continue }
      const owner = file.repository ?? ''
      const row = repositoryRows.get(owner)
      if (row === undefined) { files.push(file); continue }
      if (file.state === 'committed' && !row.headChanged) { files.push(file); continue }
      const ownerPath = file.repositoryPath ?? (owner === '' ? file.path : posixPath(relative(nativePath(owner), nativePath(file.path))))
      const ownerOldPath = file.oldPath === undefined
        ? undefined
        : owner === '' ? file.oldPath : posixPath(relative(nativePath(owner), nativePath(file.oldPath)))
      const endObject = (await gitMaybe(repository, ['rev-parse', `${stored.tree}:${file.path}`]))?.trim() ?? null
      const headObject = row.head === null ? null : (await gitMaybe(row.repository, ['rev-parse', `HEAD:${ownerPath}`]))?.trim() ?? null
      const touched = row.changed.has(ownerPath) || (ownerOldPath !== undefined && row.changed.has(ownerOldPath))
      const remainsDirty = row.dirty.has(ownerPath) || (ownerOldPath !== undefined && row.dirty.has(ownerOldPath))
      const ignored = file.state === 'pending'
        && await gitMaybe(row.repository, ['check-ignore', '-q', '--', ownerPath]) !== null
      // A later fast-forward commit of this path subsumes earlier turns even
      // when a newer turn changed the same file again. Amend/reset and other
      // non-fast-forward moves require the exact end object instead.
      // Exact tree equality and a newly ignored untracked path also resolve
      // generated files that no longer belong to Git's working change set.
      const state = !remainsDirty && (ignored || endObject === headObject || (touched && row.fastForward))
        ? 'committed' as const
        : 'pending' as const
      files.push(file.state === state ? file : { ...file, state })
      if (file.state !== state) moved = true
    }
    if (!moved) return remember(stored)
    const manifest: TurnManifest = stored.manifest.version === 1
      ? { ...stored.manifest, head: currentHead, files }
      : {
          ...stored.manifest,
          repositories: stored.manifest.repositories.map(item => ({ ...item, head: repositoryRows.get(item.path)?.head ?? item.head })),
          files,
        }
    if (files.every(file => file.state !== 'pending')) {
      await git(repository, ['update-ref', '-d', stored.ref])
      return remember(null)
    }
    const commit = await writeTurn(repository, stored.ref, stored.tree, manifest, stored.parent)
    return remember({ ...stored, commit, manifest })
  }

  /** Compare an open turn's retained start tree with the live worktree. */
  private async materializeCurrent(repository: ReviewRepository, start: StoredTurn): Promise<StoredTurn | null> {
    if (start.manifest.phase !== 'start') return start
    const cached = this.liveSnapshots.get(start.ref)
    if (cached !== undefined && cached.expires > Date.now()) return cached.value
    let end = await snapshotWorkspace(repository)
    end = await preserveUnavailableRepositories(repository, end, start.tree, manifestRepositories(start.manifest))
    const endTree = end.tree
    const files = parseNameStatus(await gitDiff(repository, ['--name-status', '-z', '--find-renames', start.tree, endTree]))
    if (files.length === 0) {
      this.liveSnapshots.set(start.ref, { expires: Date.now() + 750, value: null })
      return null
    }
    const stats = parseNumstat(await gitDiff(repository, ['--numstat', '-z', '--find-renames', start.tree, endTree]))
    const value: StoredTurn = {
      ...start,
      tree: endTree,
      parent: start.commit,
      manifest: {
        ...start.manifest,
        phase: 'end',
        files: await enrichTurnPresentations(repository, start.tree, endTree, attachNumstat(files.map(file => {
          const inventory = start.manifest.version === 2 ? start.manifest.inventory ?? [] : []
          const owner = end.files.get(file.path) ?? inventory.find(item => item.path === (file.oldPath ?? file.path))
          return owner === undefined ? file : { ...file, repository: owner.repository, repositoryPath: owner.repositoryPath, kind: owner.kind }
        }), stats)),
      },
    }
    this.liveSnapshots.set(start.ref, { expires: Date.now() + 750, value })
    return value
  }

  private async selectedTurn(session: Session, repository: ReviewRepository, turn: number): Promise<{ stored: StoredTurn; current: boolean } | null> {
    const retained = (await this.storedTurns(session, repository)).find(row => row.manifest.turn === turn)
    if (retained === undefined) return null
    if (retained.manifest.phase === 'start') {
      const current = await this.materializeCurrent(repository, retained)
      return current === null ? null : { stored: current, current: true }
    }
    const stored = await this.reconcile(repository, retained)
    return stored === null ? null : { stored, current: false }
  }

  private exactTurnFiles(tracker: TurnDiffTracker): ReviewTurnFile[] {
    return [...tracker.files.values()].map(file => ({
      path: file.path, state: 'pending' as const,
      kind: 'file' as const, presentation: 'text' as const, lineStatsState: 'unknown' as const,
    }))
  }

  private async historyView(session: Session, repository: ReviewRepository, preferExact: boolean): Promise<Extract<ReviewHistoryResult, { ok: true }>> {
    const retainedTurns = await this.storedTurns(session, repository)
    const completed = retainedTurns.filter(turn => turn.manifest.phase === 'end')
    const states = repository.kind === 'git' && completed.length > 0
      ? await this.reconciliationStates(repository, completed)
      : undefined
    const projected = (await Promise.all(retainedTurns.map(async retained => {
      if (retained.manifest.phase === 'start') {
        const tracker = this.turnTrackers.get(this.trackerKey(session, retained.manifest.turn))
        if (preferExact && tracker !== undefined && !tracker.dirty) {
          const files = this.exactTurnFiles(tracker)
          return files.length === 0 ? null : { manifest: { ...retained.manifest, phase: 'end' as const, files }, current: true }
        }
        const current = await this.materializeCurrent(repository, retained)
        return current === null ? null : { manifest: current.manifest, current: true }
      }
      const stored = await this.reconcile(repository, retained, states)
      return stored === null ? null : { manifest: stored.manifest, current: false }
    }))).filter((turn): turn is { manifest: TurnManifest; current: boolean } => turn !== null)
    const latestActive = repository.kind === 'git'
      ? projected.find(turn => !turn.current && turn.manifest.files.some(file => file.state === 'pending'))?.manifest.turn
      : undefined
    return {
      ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
      head: states?.get('')?.head ?? await head(repository),
      turns: projected.map(({ manifest, current }) => ({
        turn: manifest.turn, ...(current ? { current: true } : {}), totalFiles: manifest.files.length,
        remainingFiles: manifest.files.filter(file => file.state === 'pending').length,
        additions: manifest.files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: manifest.files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        state: turnState(manifest.files),
        undoable: repository.kind === 'git' && !current && manifest.turn === latestActive
          && new Set(manifest.files.filter(file => file.state === 'pending').map(file => file.repository ?? '')).size <= 1,
        ...(new Set(manifest.files.filter(file => file.state === 'pending').map(file => file.repository ?? '')).size > 1
          ? { undoDisabledReason: 'cross-repository' as const } : {}),
        files: manifest.files,
      })),
    }
  }

  @Remote('history')
  async history(session: Session): Promise<ReviewHistoryResult> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch (error) { return boundaryFailure(error) }
    try { return await this.historyView(session, repository, false) }
    catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  private retainGeneration(input: Omit<ReviewGeneration, 'id' | 'expires'>): ReviewGeneration {
    const id = `${input.sessionId}:${String(input.epoch)}:${String(++this.generationSerial)}`
    const generation: ReviewGeneration = { ...input, id, expires: Date.now() + REVIEW_GENERATION_TTL_MS }
    this.generations.set(id, generation)
    for (const [key, candidate] of this.generations) {
      if (candidate.expires <= Date.now()) this.dropGeneration(key)
    }
    while (this.generations.size > REVIEW_GENERATION_LIMIT) {
      const oldest = this.generations.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.dropGeneration(oldest)
    }
    return generation
  }

  private generationFor(session: Session, id: string): ReviewGeneration | null {
    const generation = this.generations.get(id)
    if (generation === undefined || generation.sessionId !== String(session.id) || generation.expires <= Date.now()) {
      if (generation !== undefined) this.dropGeneration(id)
      return null
    }
    generation.expires = Date.now() + REVIEW_GENERATION_TTL_MS
    return generation
  }

  private dropGeneration(id: string): void {
    const generation = this.generations.get(id)
    if (generation?.aggregateTimer !== undefined) clearTimeout(generation.aggregateTimer)
    generation?.catFile?.close()
    this.generations.delete(id)
  }

  private trimGenerationBytes(preserveId: string): void {
    let retained = [...this.generations.values()].reduce((sum, generation) => (
      sum + (generation.patchBytes ?? 0) + (generation.sourceBytes ?? 0)
    ), 0)
    if (retained <= GENERATION_CACHE_BYTES) return
    for (const [id, generation] of this.generations) {
      if (id === preserveId) continue
      retained -= (generation.patchBytes ?? 0) + (generation.sourceBytes ?? 0)
      this.dropGeneration(id)
      if (retained <= GENERATION_CACHE_BYTES) break
    }
  }

  @Remote('manifest')
  async manifest(session: Session, scope?: ReviewScope, location?: ReviewLocation): Promise<ReviewManifestResult> {
    let root: ReviewRepository
    let repository: ReviewRepository
    try {
      root = await repositoryFor(session)
      this.ensureWatcher(session, root.root)
      repository = await repositoryAt(root, location)
    } catch (error) { return boundaryFailure(error) }
    try {
      const selected = scope ?? 'uncommitted'
      // Git worktree scopes publish their file shell first. Historical
      // reconciliation is independent and the client fills it through the
      // existing history RPC without delaying the first Review frame.
      const deferHistory = repository.kind === 'git' && typeof selected === 'string'
      const history = deferHistory ? null : await this.historyView(session, root, true)
      const tracker = typeof selected === 'object' ? this.turnTrackers.get(this.trackerKey(session, selected.turn)) : undefined
      const exact = tracker !== undefined && !tracker.dirty
      let branch = ''
      let files: GenerationFile[] = []
      let additions = 0
      let deletions = 0
      let startTree: string | undefined
      let endTree: string | undefined
      let exactFiles: Map<string, ExactTurnFile> | undefined
      let overlayFiles: Map<string, ExactTurnFile> | undefined
      let snapshot: (() => Promise<GitScopeSnapshot>) | undefined
      let generationHead = history?.head
      let generationRepository = repository

      if (exact && tracker !== undefined) {
        branch = repository.kind === 'git' ? (await porcelainStatus(repository)).branch : ''
        const prefix = repository.location === '' ? '' : `${repository.location}/`
        exactFiles = new Map()
        for (const input of tracker.files.values()) {
          if (prefix !== '' && !input.path.startsWith(prefix)) continue
          const path = prefix === '' ? input.path : input.path.slice(prefix.length)
          const local: ExactTurnFile = { ...input, path }
          exactFiles.set(path, local)
          const renderable = (input.before?.length ?? 0) + input.after.length <= EXACT_DIFF_TEXT_LIMIT
          files.push({
            path, index: ' ', workingTree: 'M', kind: 'file', presentation: renderable ? 'text' : 'unknown',
            lineStatsState: 'pending',
            workspacePath: path,
          })
        }
      } else if (typeof selected === 'string' && repository.kind === 'git') {
        // Metadata-first Git manifest: porcelain supplies the stable file
        // shell. Authoritative tree construction stays lazy so exact tracker
        // overlays and the first paint never compete with an unused full
        // workspace snapshot.
        const entry = this.gitScopeSnapshot(session, repository, selected, true)
        const seed = await entry.seed
        snapshot = entry.full
        branch = seed.raw.branch
        generationHead = seed.head
        files = seed.selectedFiles.map(file => ({
          ...file,
          lineStatsState: file.kind === 'repository' || file.kind === 'submodule' ? 'not-applicable' : 'pending',
          workspacePath: file.path,
          ...(file.oldPath === undefined ? {} : { workspaceOldPath: file.oldPath }),
        }))
        if (selected === 'uncommitted') {
          const live = this.latestExactTracker(session)
          if (live !== undefined) {
            const prefix = repository.location === '' ? '' : `${repository.location}/`
            const available = new Set(files.map(file => file.path))
            overlayFiles = new Map()
            for (const row of live.files.values()) {
              if (prefix !== '' && !row.path.startsWith(prefix)) continue
              const path = prefix === '' ? row.path : row.path.slice(prefix.length)
              if (available.has(path)) overlayFiles.set(path, { ...row, path })
            }
            if (overlayFiles.size === 0) overlayFiles = undefined
          }
          // The overlay needs only the baseline object, not a synthetic live
          // tree. An unborn repository pays the empty-tree command once.
          startTree = seed.head ?? await emptyTree(repository)
        }
      } else {
        const [statusResult, summaryResult] = await Promise.all([
          this.status(session, selected, location),
          this.summary(session, selected, location),
        ])
        if (!statusResult.ok) return statusResult
        if (!summaryResult.ok) return summaryResult
        branch = statusResult.branch
        additions = summaryResult.additions
        deletions = summaryResult.deletions
        const summaries = new Map(summaryResult.files.map(file => [file.path, file] as const))
        files = statusResult.files.map(file => {
          const summary = summaries.get(file.path)
          const workspacePath = typeof selected === 'object' && repository.location !== ''
            ? posixPath(`${repository.location}/${file.path}`) : file.path
          const workspaceOldPath = file.oldPath === undefined ? undefined
            : typeof selected === 'object' && repository.location !== '' ? posixPath(`${repository.location}/${file.oldPath}`) : file.oldPath
          return { ...file, ...summary, workspacePath, ...(workspaceOldPath === undefined ? {} : { workspaceOldPath }) }
        })
        if (typeof selected === 'object') {
          const turn = await this.selectedTurn(session, root, selected.turn)
          if (turn?.stored.parent !== undefined) {
            startTree = (await git(root, ['show', '-s', '--format=%T', turn.stored.parent])).trim()
            endTree = turn.stored.tree
            generationRepository = root
          }
        }
      }

      const layerKind: ReviewPatchLayer['kind'] = typeof selected === 'object' ? 'turn'
        : selected === 'staged' ? 'staged' : selected === 'unstaged' ? 'working-tree' : 'uncommitted'
      const oldRevision = typeof selected === 'object' ? 'turn-start' : selected === 'unstaged' ? 'index' : 'head'
      const newRevision = typeof selected === 'object' ? 'turn-end' : selected === 'staged' ? 'index' : 'worktree'
      const epoch = this.epoch(session)
      const generation = this.retainGeneration({
        sessionId: String(session.id), epoch, repository: generationRepository, scope: selected,
        location: { repository: repository.location }, files, layerKind, oldRevision, newRevision,
        ...(startTree === undefined ? {} : { startTree }), ...(endTree === undefined ? {} : { endTree }),
        ...(snapshot === undefined ? {} : { snapshot }),
        ...(exactFiles === undefined ? {} : { exact: exactFiles }),
        ...(overlayFiles === undefined ? {} : { overlay: overlayFiles }),
      })
      return {
        ok: true, generation: generation.id, epoch,
        consistency: exact ? 'live-exact' : tracker?.dirty === true ? 'live-reconciling' : 'authoritative',
        repositoryRoot: repository.root, workspaceKind: repository.kind, ...(generationHead === undefined ? {} : { head: generationHead }),
        branch, scope: selected, location: { repository: repository.location }, additions, deletions,
        files: files.map(({ workspacePath: _workspacePath, workspaceOldPath: _workspaceOldPath, ...file }) => file),
        turns: history?.turns ?? [],
        ...(snapshot === undefined ? {} : { summaryPending: true }),
        ...(deferHistory ? { historyPending: true } : {}),
      }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  private async ensureGenerationTrees(generation: ReviewGeneration): Promise<void> {
    if (generation.startTree !== undefined && generation.endTree !== undefined) return
    if (generation.snapshot === undefined) return
    const snapshot = await generation.snapshot()
    generation.startTree = snapshot.start
    generation.endTree = snapshot.end
  }

  private retainPatchRows(generation: ReviewGeneration, files: readonly GenerationFile[], rows: ReadonlyMap<string, string>): void {
    generation.patchCache ??= new Map()
    for (const file of files) generation.patchCache.set(file.path, rows.get(file.path) ?? '')
    generation.patchBytes = [...generation.patchCache.values()].reduce((sum, patch) => sum + Buffer.byteLength(patch), 0)
    this.trimGenerationBytes(generation.id)
  }

  private async computeGenerationPatches(generation: ReviewGeneration, files: readonly GenerationFile[]): Promise<Map<string, string>> {
    if (files.length === 0) return new Map()
    if (generation.exact !== undefined) {
      const exact = files.flatMap(file => {
        const row = generation.exact?.get(file.path)
        return row === undefined ? [] : [row]
      })
      return await exactPatchMapInWorker(exact)
    }
    const result = new Map<string, string>()
    const overlayFiles = generation.startTree === undefined ? [] : files.filter(file => (
      file.workspaceOldPath === undefined && generation.overlay?.has(file.path)
    ))
    if (overlayFiles.length > 0 && generation.startTree !== undefined) {
      generation.catFile ??= new GitCatFileBatch(generation.repository)
      const exact = await Promise.all(overlayFiles.map(async file => ({
        path: file.path,
        before: await generation.catFile?.read(generation.startTree as string, file.workspacePath) ?? null,
        after: generation.overlay?.get(file.path)?.after ?? '',
      })))
      for (const [path, patch] of await exactPatchMapInWorker(exact)) result.set(path, patch)
    }
    const remaining = files.filter(file => !overlayFiles.includes(file))
    if (remaining.length === 0) return result
    await this.ensureGenerationTrees(generation)
    if (generation.startTree === undefined || generation.endTree === undefined) return result
    const pathspec = [...new Set(remaining.flatMap(file => [file.workspaceOldPath, file.workspacePath]
      .filter((path): path is string => path !== undefined)))]
    const patch = await gitDiff(generation.repository, [
      '--find-renames', '--find-copies', '--unified=3', '--no-prefix', generation.startTree, generation.endTree,
      ...(pathspec.length === 0 ? [] : ['--', ...pathspec]),
    ])
    for (const [path, value] of mapPatchBlocks(patch, remaining)) result.set(path, value)
    return result
  }

  private scheduleAggregatePatches(generation: ReviewGeneration): void {
    if ((generation.patchBatchCount ?? 0) < AGGREGATE_PATCH_BATCH_THRESHOLD
      || generation.aggregateTask !== undefined || generation.patchCache?.size === generation.files.length) return
    if (generation.aggregateTimer !== undefined) clearTimeout(generation.aggregateTimer)
    generation.aggregateTimer = setTimeout(() => {
      delete generation.aggregateTimer
      if (!this.generations.has(generation.id)) return
      generation.aggregateTask = this.computeGenerationPatches(generation, generation.files).then(rows => {
        if (this.generations.has(generation.id)) this.retainPatchRows(generation, generation.files, rows)
      }).finally(() => { delete generation.aggregateTask })
    }, 500)
    generation.aggregateTimer.unref?.()
  }

  private async generationPatches(generation: ReviewGeneration, paths: ReadonlySet<string>): Promise<Map<string, string>> {
    generation.patchCache ??= new Map()
    generation.patchTasks ??= new Map()
    if (generation.aggregateTimer !== undefined) {
      clearTimeout(generation.aggregateTimer)
      delete generation.aggregateTimer
    }
    const files = generation.files.filter(file => paths.has(file.path))
    const waiting = new Set<Promise<void>>()
    const missing = files.filter(file => {
      if (generation.patchCache?.has(file.path)) return false
      const task = generation.patchTasks?.get(file.path)
      if (task !== undefined) waiting.add(task)
      return task === undefined
    })
    if (missing.length > 0) {
      generation.patchBatchCount = (generation.patchBatchCount ?? 0) + 1
      const task = this.computeGenerationPatches(generation, missing).then(rows => {
        if (this.generations.has(generation.id)) this.retainPatchRows(generation, missing, rows)
      }).finally(() => {
        for (const file of missing) {
          if (generation.patchTasks?.get(file.path) === task) generation.patchTasks.delete(file.path)
        }
      })
      for (const file of missing) generation.patchTasks.set(file.path, task)
      waiting.add(task)
    }
    await Promise.all(waiting)
    this.scheduleAggregatePatches(generation)
    return new Map(files.map(file => [file.path, generation.patchCache?.get(file.path) ?? '']))
  }

  @Remote('patches')
  async patches(session: Session, generationId: string, paths: string[]): Promise<ReviewPatchesResult> {
    const generation = this.generationFor(session, generationId)
    if (generation === null) return { ok: false, code: 'STALE_GENERATION', message: 'Review generation expired; refresh the manifest.' }
    try {
      const requested = new Set(paths.map(posixPath))
      const patchMap = await this.generationPatches(generation, requested)
      const files: ReviewPatchFile[] = []
      for (const file of generation.files) {
        if (!requested.has(file.path) || file.kind === 'repository' || file.kind === 'submodule') continue
        const patch = patchMap.get(file.path) ?? ''
        const stats = patch === '' ? undefined : patchStats(patch)
        const exact = generation.exact?.get(file.path)
        files.push({
          path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
          ...(file.kind === undefined ? {} : { kind: file.kind }),
          presentation: patch === '' ? file.presentation ?? 'unknown' : file.presentation ?? 'text',
          lineStatsState: patch === '' ? file.lineStatsState === 'not-applicable' ? 'not-applicable' : 'unknown' : 'available',
          ...(stats === undefined ? {} : stats),
          layers: patch === '' ? [] : [{
            kind: generation.layerKind, patch, oldRevision: generation.oldRevision, newRevision: generation.newRevision,
            ...(exact === undefined ? {} : { oldLineCount: textLineCount(exact.before), newLineCount: textLineCount(exact.after) }),
          }],
        })
      }
      return { ok: true, generation: generation.id, files }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('source')
  async source(session: Session, generationId: string, path: string, side: ReviewSourceSide): Promise<ReviewSourceResult> {
    const generation = this.generationFor(session, generationId)
    if (generation === null) return { ok: false, code: 'STALE_GENERATION', message: 'Review generation expired; refresh the manifest.' }
    const normalized = posixPath(path)
    const file = generation.files.find(candidate => candidate.path === normalized)
    if (file === undefined) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path is outside this generation.' }
    try {
      const cacheKey = `${file.path}\0${side}`
      generation.sourceCache ??= new Map()
      const cached = generation.sourceCache.get(cacheKey)
      let text: string | null
      if (cached !== undefined) {
        generation.sourceCache.delete(cacheKey)
        generation.sourceCache.set(cacheKey, cached)
        text = cached.text
      } else {
        generation.sourceTasks ??= new Map()
        let task = generation.sourceTasks.get(cacheKey)
        if (task === undefined) {
          task = (async () => {
            const exact = generation.exact?.get(file.path)
            if (exact !== undefined) return side === 'old' ? exact.before : exact.after
            const overlay = generation.overlay?.get(file.path)
            if (overlay !== undefined && side === 'new') return overlay.after
            await this.ensureGenerationTrees(generation)
            const tree = side === 'old' ? generation.startTree : generation.endTree
            if (tree === undefined) return null
            const objectPath = side === 'old' ? file.workspaceOldPath ?? file.workspacePath : file.workspacePath
            if (objectPath.includes('\n')) return await treeText(generation.repository, tree, objectPath)
            generation.catFile ??= new GitCatFileBatch(generation.repository)
            return await generation.catFile.read(tree, objectPath)
          })()
          generation.sourceTasks.set(cacheKey, task)
        }
        try { text = await task } finally { generation.sourceTasks.delete(cacheKey) }
        const settled = generation.sourceCache.get(cacheKey)
        const bytes = text === null ? 1 : Buffer.byteLength(text)
        if (settled === undefined) {
          generation.sourceCache.set(cacheKey, { text, bytes })
          generation.sourceBytes = (generation.sourceBytes ?? 0) + bytes
        } else {
          text = settled.text
        }
        while ((generation.sourceBytes ?? 0) > GENERATION_SOURCE_BYTES) {
          const oldest = generation.sourceCache.keys().next().value as string | undefined
          if (oldest === undefined) break
          const removed = generation.sourceCache.get(oldest)
          generation.sourceCache.delete(oldest)
          generation.sourceBytes = Math.max(0, (generation.sourceBytes ?? 0) - (removed?.bytes ?? 0))
        }
        this.trimGenerationBytes(generation.id)
      }
      return { ok: true, generation: generation.id, path: normalized, side, text }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('probe')
  async probe(session: Session, knownEpoch: number): Promise<ReviewProbeResult> {
    try {
      const repository = await repositoryFor(session)
      this.ensureWatcher(session, repository.root)
      const epoch = this.epoch(session)
      return { ok: true, epoch, changed: epoch !== knownEpoch }
    } catch (error) {
      if (error instanceof ReviewBoundaryError) return { ok: false, code: 'NO_WORKSPACE', message: error.message }
      return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) }
    }
  }

  @Remote('status')
  async status(session: Session, scope?: ReviewScope, location?: ReviewLocation): Promise<ReviewStatusResult> {
    let root: ReviewRepository
    let repository: ReviewRepository
    try { root = await repositoryFor(session); repository = await repositoryAt(root, location) } catch (error) { return boundaryFailure(error) }
    try {
      const selected: ReviewScope = scope ?? 'uncommitted'
      if (repository.kind === 'filesystem' && typeof selected === 'string') {
        return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: '', scope: selected, location: { repository: repository.location }, files: [] }
      }
      if (typeof selected === 'object') {
        const raw = repository.kind === 'git'
          ? await porcelainStatus(repository)
          : { branch: '', files: [] }
        const selectedTurn = await this.selectedTurn(session, root, selected.turn)
        if (selectedTurn === null) return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${selected.turn} has no retained changes.` }
        const { stored } = selectedTurn
        const files = stored.manifest.files.filter(file => file.state === 'pending'
          && (repository.location === '' || (file.repository ?? '') === repository.location)).map(file => ({
          path: repository.location === '' ? file.path : file.repositoryPath ?? file.path,
          ...(file.oldPath === undefined ? {} : {
            oldPath: repository.location === '' ? file.oldPath : posixPath(file.oldPath.slice(repository.location.length + 1)),
          }),
          index: ' ', workingTree: 'M', kind: file.kind ?? 'file', presentation: file.presentation ?? 'unknown',
          ...(file.repository === undefined ? {} : { repository: file.repository }),
        }))
        return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: raw.branch, scope: selected, location: { repository: repository.location }, files }
      }
      const seed = await this.gitScopeSnapshot(session, repository, selected, true).seed
      return {
        ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: seed.raw.branch,
        scope: selected, location: { repository: repository.location }, files: seed.selectedFiles,
      }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('summary')
  async summary(session: Session, scope?: ReviewScope, location?: ReviewLocation): Promise<ReviewSummaryResult> {
    let root: ReviewRepository
    let repository: ReviewRepository
    try { root = await repositoryFor(session); repository = await repositoryAt(root, location) } catch (error) { return boundaryFailure(error) }
    try {
      const selected: ReviewScope = scope ?? 'uncommitted'
      if (repository.kind === 'filesystem' && typeof selected === 'string') {
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, location: { repository: repository.location }, additions: 0, deletions: 0, files: [],
        }
      }
      let startTree: string
      let endTree: string
      let files: Array<ReviewFileSummary & { workspacePath?: string }>
      if (typeof selected === 'object') {
        const selectedTurn = await this.selectedTurn(session, root, selected.turn)
        const stored = selectedTurn?.stored
        if (stored === undefined || stored.parent === undefined) {
          return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${selected.turn} has no retained changes.` }
        }
        startTree = (await git(root, ['show', '-s', '--format=%T', stored.parent])).trim()
        endTree = stored.tree
        files = stored.manifest.files
          .filter(file => file.state === 'pending' && (repository.location === '' || (file.repository ?? '') === repository.location))
          .map(file => ({
            path: repository.location === '' ? file.path : file.repositoryPath ?? file.path,
            ...(file.oldPath === undefined ? {} : { oldPath: repository.location === '' ? file.oldPath : posixPath(file.oldPath.slice(repository.location.length + 1)) }),
            ...(file.additions === undefined ? {} : { additions: file.additions }),
            ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
            binary: file.presentation === 'binary',
            ...(file.kind === undefined ? {} : { kind: file.kind }),
            ...(file.presentation === undefined ? {} : { presentation: file.presentation }),
            ...(file.lineStatsState === undefined ? {} : { lineStatsState: file.lineStatsState }),
            ...(file.repository === undefined ? {} : { repository: file.repository }),
            workspacePath: file.path,
          }))
        const summarized = files.map(file => ({
          path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
          ...(file.additions === undefined ? {} : { additions: file.additions }),
          ...(file.deletions === undefined ? {} : { deletions: file.deletions }),
          ...(file.binary === undefined ? {} : { binary: file.binary }),
          ...(file.kind === undefined ? {} : { kind: file.kind }),
          ...(file.presentation === undefined ? {} : { presentation: file.presentation }),
          lineStatsState: file.lineStatsState ?? 'unknown',
          ...(file.repository === undefined ? {} : { repository: file.repository }),
        }))
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, scope: selected,
          location: { repository: repository.location },
          additions: summarized.reduce((sum, file) => sum + (file.additions ?? 0), 0),
          deletions: summarized.reduce((sum, file) => sum + (file.deletions ?? 0), 0), files: summarized,
        }
      } else {
        const snapshot = await this.gitScopeSnapshot(session, repository, selected, false).full()
        startTree = snapshot.start
        endTree = snapshot.end
        files = snapshot.selectedFiles
        const atomic = files.filter(file => file.kind === 'repository' || file.kind === 'submodule')
        const byPath = new Map(files.flatMap(file => [
          [file.path, file] as const,
          ...(file.oldPath === undefined ? [] : [[file.oldPath, file] as const]),
        ]))
        const changed = parseNameStatus(await gitDiff(repository, ['--name-status', '-z', '--find-renames', startTree, endTree]))
        files = [
          ...changed.map(file => {
            const metadata = byPath.get(file.path) ?? (file.oldPath === undefined ? undefined : byPath.get(file.oldPath))
            return {
              path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }),
              ...(metadata?.kind === undefined ? { kind: 'file' as const } : { kind: metadata.kind }),
              ...(file.oldPath !== undefined ? { presentation: 'rename' as const }
                : metadata?.presentation === undefined ? {} : { presentation: metadata.presentation }),
              ...(metadata?.repository === undefined ? {} : { repository: metadata.repository }),
            }
          }),
          ...atomic,
        ]
      }
      if (files.length === 0) {
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, location: { repository: repository.location }, additions: 0, deletions: 0, files: [],
        }
      }
      const atomic = files.filter(file => file.kind === 'repository' || file.kind === 'submodule')
      const measurable = files.filter(file => file.kind !== 'repository' && file.kind !== 'submodule')
      const paths = measurable.flatMap(file => [file.oldPath, file.path].filter((path): path is string => path !== undefined))
      const stats = paths.length === 0
        ? new Map<string, Numstat>()
        : parseNumstat(await gitDiff(repository, ['--numstat', '-z', '--find-renames', startTree, endTree, '--', ...paths]))
      const measuredSummaries = await Promise.all(measurable.map(async file => {
        const row = stats.get(file.path)
        if (row === undefined) return { ...file, lineStatsState: 'unknown' as const, presentation: file.presentation ?? 'unknown' as const }
        if (row.binary) return { ...file, additions: 0, deletions: 0, binary: true, lineStatsState: 'not-applicable' as const, presentation: 'binary' as const }
        if (row.additions === 0 && row.deletions === 0) {
          let presentation = file.presentation === 'rename' || file.presentation === 'mode' || file.presentation === 'empty'
            ? file.presentation : 'unknown' as ReviewPresentation
          if (presentation === 'unknown') {
            const before = await treeText(repository, startTree, file.oldPath ?? file.path)
            const after = await treeText(repository, endTree, file.path)
            if ((before === '' && after === null) || (before === null && after === '')) presentation = 'empty'
          }
          return { ...file, additions: 0, deletions: 0, binary: false, lineStatsState: 'not-applicable' as const, presentation }
        }
        return { ...file, additions: row.additions, deletions: row.deletions, binary: false, lineStatsState: 'available' as const, presentation: 'text' as const }
      }))
      const summarized = [...measuredSummaries, ...atomic.map(file => ({ ...file, lineStatsState: 'not-applicable' as const, presentation: file.kind as 'repository' | 'submodule' }))]
      return {
        ok: true,
        repositoryRoot: repository.root,
        workspaceKind: repository.kind,
        scope: selected,
        location: { repository: repository.location },
        additions: summarized.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: summarized.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        files: summarized,
      }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('diff')
  async diff(session: Session, path: string, scope?: ReviewScope, location?: ReviewLocation): Promise<ReviewDiffResult> {
    let root: ReviewRepository
    let repository: ReviewRepository
    try { root = await repositoryFor(session); repository = await repositoryAt(root, location) } catch (error) { return boundaryFailure(error) }
    try {
      const selected: ReviewScope = scope ?? 'uncommitted'
      if (isAbsolute(path)) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path must be repository-relative.' }
      const normalizedPath = posixPath(path)
      const target = resolve(repository.root, nativePath(normalizedPath))
      const rel = posixPath(relative(repository.root, target))
      if (!isWithin(repository.root, target)) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path is outside the workspace.' }
      if (repository.kind === 'filesystem' && typeof selected === 'string') {
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, location: { repository: repository.location }, path: rel, presentation: 'unknown', lineStatsState: 'unknown', layers: [],
        }
      }
      if (typeof selected === 'object') {
        const selectedTurn = await this.selectedTurn(session, root, selected.turn)
        const stored = selectedTurn?.stored
        if (stored === undefined) return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${selected.turn} has no retained changes.` }
        // A parentless record is a reverted tombstone. Its heavy start/end
        // snapshots have already been released, so the historical scope is
        // intentionally empty rather than an unavailable/error state.
        if (stored.parent === undefined) {
          return {
            ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
            scope: selected, location: { repository: repository.location }, path: rel, presentation: 'unknown', lineStatsState: 'unknown', layers: [],
          }
        }
        const workspacePath = repository.location === '' ? rel : posixPath(`${repository.location}/${rel}`)
        const file = stored.manifest.files.find(file => file.path === workspacePath || file.oldPath === workspacePath)
        if (file === undefined || file.state !== 'pending') {
          return {
            ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
            scope: selected, location: { repository: repository.location }, path: rel, presentation: 'unknown', lineStatsState: 'unknown', layers: [],
          }
        }
        const oldPath = file.oldPath ?? file.path
        const startTree = (await git(root, ['show', '-s', '--format=%T', stored.parent])).trim()
        const patch = await gitDiff(root, ['--find-renames', '--find-copies', '--unified=3', startTree, stored.tree, '--', oldPath, file.path])
        const layers: ReviewPatchLayer[] = patch === '' ? [] : [{
          kind: 'turn', patch,
          oldSource: { revision: 'turn-start', text: file.presentation === 'binary' ? null : await treeText(root, startTree, oldPath) },
          newSource: { revision: 'turn-end', text: file.presentation === 'binary' ? null : await treeText(root, stored.tree, file.path) },
        }]
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, location: { repository: repository.location },
          path: repository.location === '' ? file.path : file.repositoryPath ?? rel,
          ...(file.oldPath === undefined ? {} : { oldPath: repository.location === '' ? file.oldPath : posixPath(file.oldPath.slice(repository.location.length + 1)) }),
          kind: file.kind ?? 'file', presentation: file.presentation ?? (patch === '' ? 'unknown' : 'text'),
          lineStatsState: file.lineStatsState ?? 'unknown', layers,
        }
      }
      const snapshot = await this.gitScopeSnapshot(session, repository, selected, false).full()
      const status = snapshot.raw.files.find(file => file.path === rel || file.oldPath === rel)
      const oldPath = status?.oldPath ?? rel
      const publicFile = snapshot.selectedFiles.find(file => file.path === status?.path)
      const kind = publicFile?.kind ?? 'file'
      const hintedPresentation = publicFile?.presentation ?? 'unknown'
      if (kind === 'repository' || kind === 'submodule') return {
        ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, scope: selected,
        location: { repository: repository.location }, path: rel, kind, presentation: kind,
        lineStatsState: 'not-applicable', layers: [],
      }
      let patch = ''
      let layerKind: ReviewPatchLayer['kind']
      if (selected === 'staged') {
        patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', snapshot.baseline, snapshot.index, '--', oldPath, rel])
        layerKind = 'staged'
      } else if (selected === 'unstaged') {
        patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', snapshot.index, snapshot.live, '--', oldPath, rel])
        layerKind = 'working-tree'
      } else {
        patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', snapshot.baseline, snapshot.live, '--', oldPath, rel])
        layerKind = 'uncommitted'
      }
      const binary = patch.includes('GIT binary patch') || patch.includes('Binary files ')
      const oldText = binary ? null : selected === 'unstaged'
        ? await treeText(repository, snapshot.index, oldPath) : await treeText(repository, snapshot.baseline, oldPath)
      const newText = binary ? null : selected === 'staged'
        ? await treeText(repository, snapshot.index, rel) : await treeText(repository, snapshot.live, rel)
      const presentation = patchPresentation(patch, hintedPresentation, oldText, newText)
      const hasLineChanges = /^(?:\+(?!\+\+)|-(?!--))/m.test(patch)
      const outputLayer: ReviewPatchLayer | undefined = patch === '' ? undefined : {
        kind: layerKind, patch,
        oldSource: selected === 'unstaged' ? { revision: 'index', text: oldText } : { revision: 'head', text: oldText },
        newSource: selected === 'staged' ? { revision: 'index', text: newText } : { revision: 'worktree', text: newText },
      }
      return {
        ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
        scope: selected, location: { repository: repository.location }, path: rel, ...(oldPath === rel ? {} : { oldPath }),
        kind, presentation, lineStatsState: hasLineChanges ? 'available' : 'not-applicable',
        layers: outputLayer === undefined ? [] : [outputLayer],
      }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('undoTurn')
  async undoTurn(session: Session, turn: number): Promise<ReviewUndoTurnResult> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch (error) { return boundaryFailure(error) }
    if (repository.kind === 'filesystem') {
      return { ok: false, code: 'NOT_REPOSITORY', message: 'Undo requires a Git workspace.' }
    }
    try {
      const completed = (await this.storedTurns(session, repository)).filter(row => row.manifest.phase === 'end')
      const states = await this.reconciliationStates(repository, completed)
      const turns = (await Promise.all(completed.map(row => this.reconcile(repository, row, states))))
        .filter((turn): turn is StoredTurn => turn !== null)
      const latest = turns.find(row => row.manifest.files.some(file => file.state === 'pending'))
      const stored = turns.find(row => row.manifest.turn === turn)
      if (stored === undefined || stored.parent === undefined) return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${turn} has no retained changes.` }
      if (latest?.manifest.turn !== turn) return { ok: false, code: 'NOT_LATEST', message: 'Only the latest changed turn can be undone.' }
      const pending = stored.manifest.files.filter(file => file.state === 'pending')
      if (pending.length === 0) return { ok: false, code: 'NOTHING_TO_UNDO', message: 'This turn has no uncommitted files to undo.' }
      if (new Set(pending.map(file => file.repository ?? '')).size > 1) {
        return { ok: false, code: 'CROSS_REPOSITORY', message: 'Cross-repository turns cannot be undone yet.' }
      }
      const owner = pending[0]?.repository ?? ''
      const targetRepository = owner === '' ? repository : await childRepository(resolve(repository.root, nativePath(owner)), owner)
      if (targetRepository === null) return { ok: false, code: 'CONFLICT', message: 'The repository for this turn is unavailable.' }
      const startWorkspaceTree = (await git(repository, ['show', '-s', '--format=%T', stored.parent])).trim()
      const startTree = owner === ''
        ? await rootRepositoryTree(repository, startWorkspaceTree, manifestRepositories(stored.manifest))
        : (await gitMaybe(repository, ['rev-parse', `${startWorkspaceTree}:${owner}`]))?.trim() ?? await emptyTree(targetRepository)
      const endTree = owner === ''
        ? await rootRepositoryTree(repository, stored.tree, manifestRepositories(stored.manifest))
        : (await gitMaybe(repository, ['rev-parse', `${stored.tree}:${owner}`]))?.trim() ?? await emptyTree(targetRepository)
      const paths = pending.flatMap(file => {
        const next = file.repositoryPath ?? file.path
        const previous = file.oldPath === undefined ? undefined
          : owner === '' ? file.oldPath : posixPath(file.oldPath.slice(owner.length + 1))
        return [previous, next].filter((value): value is string => value !== undefined)
      })
      const objectsPath = (await git(repository, ['rev-parse', '--git-path', 'objects'])).trim()
      const alternate = isAbsolute(objectsPath) ? objectsPath : resolve(repository.root, objectsPath)
      const objectEnv = owner === '' ? undefined : { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate }
      const baselineHead = await head(targetRepository)
      const baselineIndex = await indexTree(targetRepository)
      const baselineWorktree = await snapshotWorktree(targetRepository)
      const reverseTarget = await partialReverseTree(targetRepository, startTree, endTree, paths, objectEnv)
      const nextIndex = await mergeTrees(targetRepository, endTree, baselineIndex, reverseTarget, objectEnv)
      const nextWorktree = await mergeTrees(targetRepository, endTree, baselineWorktree, reverseTarget, objectEnv)
      if (nextIndex === null || nextWorktree === null) {
        return { ok: false, code: 'CONFLICT', message: 'The files changed after this turn and cannot be safely undone.' }
      }
      // Re-read every moving repository boundary immediately before the first
      // real write. A terminal command racing this computation makes the
      // operation expire instead of being overwritten.
      if (await head(targetRepository) !== baselineHead
        || await indexTree(targetRepository) !== baselineIndex
        || await snapshotWorktree(targetRepository) !== baselineWorktree) {
        return { ok: false, code: 'CONFLICT', message: 'The repository changed while preparing the undo. Try again.' }
      }
      const envOptions = objectEnv === undefined ? {} : { env: objectEnv }
      const worktreePatch = await gitDiff(targetRepository, ['--binary', '--full-index', baselineWorktree, nextWorktree], envOptions)
      const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-undo-'))
      const patchPath = join(temporary, 'worktree.patch')
      try {
        if (worktreePatch !== '') {
          await writeFile(patchPath, worktreePatch)
          try { await git(targetRepository, ['apply', '--check', patchPath], envOptions) }
          catch { return { ok: false, code: 'CONFLICT', message: 'The prepared undo no longer applies cleanly.' } }
          await git(targetRepository, ['apply', patchPath], envOptions)
        }
        try { await git(targetRepository, ['read-tree', nextIndex], envOptions) }
        catch (error) {
          if (worktreePatch !== '') await git(targetRepository, ['apply', '--reverse', patchPath], envOptions).catch(() => {})
          throw error
        }
      } finally { await rm(temporary, { recursive: true, force: true }) }
      const files = stored.manifest.files.map(file => file.state === 'pending' ? { ...file, state: 'reverted' as const } : file)
      const tree = await emptyTree(repository)
      const nextHead = await head(targetRepository)
      const manifest: TurnManifest = stored.manifest.version === 1
        ? { ...stored.manifest, head: nextHead, files }
        : {
            ...stored.manifest,
            repositories: stored.manifest.repositories.map(item => item.path === owner ? { ...item, head: nextHead } : item),
            files,
          }
      await writeTurn(repository, stored.ref, tree, manifest)
      return { ok: true, repositoryRoot: repository.root, turn, revertedFiles: pending.map(file => file.path) }
    } catch (error) { return { ok: false, code: 'APPLY_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('checks')
  async checks(session: Session, location?: ReviewLocation): Promise<ReviewChecksResult> {
    try {
      const root = await repositoryFor(session)
      const repository = await repositoryAt(root, location)
      if (repository.kind === 'filesystem') {
        return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, clean: true, output: '' }
      }
      try {
        const output = await git(repository, ['diff', '--check'])
        return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, clean: true, output }
      } catch (error) {
        const failure = error as { stdout?: string; stderr?: string }
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          clean: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
        }
      }
    } catch (error) { return boundaryFailure(error) }
  }
}

export default ReviewService
