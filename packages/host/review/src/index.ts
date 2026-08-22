import { execFile, spawn } from 'node:child_process'
import { access, lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ReviewChecksResult, ReviewDiffResult, ReviewEntryKind, ReviewFileStatus, ReviewFileSummary, ReviewHistoryResult,
  ReviewLocation, ReviewPatchLayer, ReviewPresentation, ReviewScope, ReviewWorkspaceKind,
  ReviewStatusResult, ReviewSummaryResult, ReviewTurnFile, ReviewTurnHistory, ReviewUndoTurnResult,
} from './types.ts'

export type {
  ReviewChecksResult, ReviewDiffResult, ReviewEntryKind, ReviewFileStatus, ReviewFileSummary, ReviewHistoryResult,
  ReviewLineStatsState, ReviewLocation, ReviewPatchLayer, ReviewPresentation, ReviewScope, ReviewSourceSnapshot, ReviewStatusResult, ReviewSummaryResult,
  ReviewTurnFile, ReviewTurnFileState, ReviewTurnHistory, ReviewUndoTurnResult, ReviewWorkspaceKind,
} from './types.ts'

const exec = promisify(execFile)
const MAX_BUFFER = 16 * 1024 * 1024
const REF_ROOT = 'refs/deepcreator/turns'

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

async function snapshotWorktree(repository: ReviewRepository): Promise<string> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-index-'))
  const indexPath = join(temporary, 'index')
  const env = { ...process.env, GIT_INDEX_FILE: indexPath }
  try {
    if (repository.kind === 'filesystem' || await head(repository) === null) await git(repository, ['read-tree', '--empty'], { env })
    else await git(repository, ['read-tree', 'HEAD'], { env })
    const paths = ['.']
    if (repository.kind === 'git') {
      // Git ranges stop at repository boundaries. An unborn nested repository
      // cannot be staged as a gitlink and would otherwise make `git add -A`
      // fail the entire Review scope, so exclude every atomic nested root.
      const status = await porcelainStatus(repository)
      for (const file of status.files) {
        if (await nestedRepositoryKind(repository, file) !== 'repository') continue
        paths.push(`:(exclude)${file.path}`, `:(exclude)${file.path}/**`)
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
    await git(repository, ['add', '-A', '--', ...paths], { env })
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
  const args = ['commit-tree', tree, '-m', JSON.stringify(manifest)]
  if (parent !== undefined) args.push('-p', parent)
  const commit = (await git(repository, args, { env: commitEnvironment() })).trim()
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

async function gitText(repository: ReviewRepository, revision: 'HEAD' | ':', path: string): Promise<string | null> {
  return await gitMaybe(repository, ['show', revision === ':' ? `:${path}` : `${revision}:${path}`])
}

async function worktreeText(repository: ReviewRepository, path: string): Promise<string | null> {
  const target = resolve(repository.root, path)
  try {
    if (!isWithin(repository.root, target)) throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Review path resolves outside the workspace.')
    const metadata = await lstat(target)
    // Git stores a symlink as the target string. Never follow it: an external
    // target is valid source data but must not become readable through Review.
    if (metadata.isSymbolicLink()) return await readlink(target)
    if (!metadata.isFile()) return null
    return await readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof ReviewBoundaryError) throw error
    return null
  }
}

function turnState(files: readonly ReviewTurnFile[]): ReviewTurnHistory['state'] {
  const states = new Set(files.map(file => file.state))
  if (states.size > 1) return 'mixed'
  const state = files[0]?.state
  return state === 'pending' || state === undefined ? 'active' : state
}

/** Host repository review and turn-snapshot service (`ctx.review`). */
export class ReviewService extends TypertRemoteService {
  static inject = ['sessions']
  private pendingSnapshots = new Map<string, Promise<void>>()
  /** One UI refresh fans out to history/status/summary/diff; share its live tree. */
  private liveSnapshots = new Map<string, { expires: number; value: StoredTurn | null }>()

  constructor(ctx: Context) {
    super(ctx, 'review')
    ctx.on('agent/pre-step', async ({ agent, turn, step }: { agent: Agent; turn: number; step: number }, next) => {
      if (step === 1) await this.captureStart(agent.session, turn)
      return next()
    })
    ctx.on('agent/turn-stopping', async ({ agent, turn }: { agent: Agent; turn: number }) => {
      await this.captureEnd(agent.session, turn)
    })
    ctx.on('session/event', (session, event) => {
      this.invalidateLiveSnapshots(session)
      if (event.type === 'turn/end') void this.captureEnd(session, event.data.turn)
    })
  }

  private invalidateLiveSnapshots(session: Session): void {
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    for (const ref of this.liveSnapshots.keys()) if (ref.startsWith(prefix)) this.liveSnapshots.delete(ref)
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
  }

  private async storedTurns(session: Session, repository: ReviewRepository): Promise<StoredTurn[]> {
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    const refs = (await gitMaybe(repository, ['for-each-ref', '--format=%(refname)', prefix]))?.trim().split('\n').filter(Boolean) ?? []
    const turns = (await Promise.all(refs.map(ref => readTurn(repository, ref))))
      .filter((turn): turn is StoredTurn => turn !== null)
    turns.sort((left, right) => right.manifest.turn - left.manifest.turn)
    return turns
  }

  /** Remove every private snapshot ref owned by a deleted session. */
  async deleteSessionSnapshots(session: Session): Promise<void> {
    const repository = await repositoryFor(session)
    const prefix = `${REF_ROOT}/${String(session.id)}/`
    const refs = (await gitMaybe(repository, ['for-each-ref', '--format=%(refname)', prefix]))?.trim().split('\n').filter(Boolean) ?? []
    for (const ref of refs) await git(repository, ['update-ref', '-d', ref])
    await rm(resolve(filesystemRepositoryPath(session), '..'), { recursive: true, force: true })
  }

  private async reconcile(repository: ReviewRepository, input: StoredTurn): Promise<StoredTurn | null> {
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
    const currentHead = await head(repository)
    if (stored.parent === undefined) {
      if (stored.manifest.files.every(file => file.state === 'committed')) {
        await git(repository, ['update-ref', '-d', stored.ref])
        return null
      }
      return stored
    }
    const repositoryRows = new Map<string, {
      repository: ReviewRepository
      head: string | null
      headChanged: boolean
      fastForward: boolean
      changed: Set<string>
      dirty: Set<string>
    }>()
    for (const baseline of manifestRepositories(stored.manifest)) {
      const child = baseline.path === '' ? repository : await childRepository(
        resolve(repository.root, nativePath(baseline.path)), baseline.path,
      )
      if (child === null) continue
      const nextHead = await head(child)
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
      const status = await porcelainStatus(child)
      repositoryRows.set(baseline.path, {
        repository: child, head: nextHead, headChanged, fastForward, changed,
        dirty: new Set(status.files.flatMap(file => [file.path, ...(file.oldPath === undefined ? [] : [file.oldPath])])),
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
    if (!moved) return stored
    const manifest: TurnManifest = stored.manifest.version === 1
      ? { ...stored.manifest, head: currentHead, files }
      : {
          ...stored.manifest,
          repositories: stored.manifest.repositories.map(item => ({ ...item, head: repositoryRows.get(item.path)?.head ?? item.head })),
          files,
        }
    if (files.every(file => file.state !== 'pending')) {
      await git(repository, ['update-ref', '-d', stored.ref])
      return null
    }
    const commit = await writeTurn(repository, stored.ref, stored.tree, manifest, stored.parent)
    return { ...stored, commit, manifest }
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

  @Remote('history')
  async history(session: Session): Promise<ReviewHistoryResult> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch (error) { return boundaryFailure(error) }
    try {
      const turns = (await Promise.all((await this.storedTurns(session, repository)).map(async retained => {
        if (retained.manifest.phase === 'start') {
          const current = await this.materializeCurrent(repository, retained)
          return current === null ? null : { stored: current, current: true }
        }
        const stored = await this.reconcile(repository, retained)
        return stored === null ? null : { stored, current: false }
      }))).filter((turn): turn is { stored: StoredTurn; current: boolean } => turn !== null)
      const latestActive = repository.kind === 'git'
        ? turns.find(turn => !turn.current && turn.stored.manifest.files.some(file => file.state === 'pending'))?.stored.manifest.turn
        : undefined
      return {
        ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, head: await head(repository),
        turns: turns.map(({ stored: { manifest }, current }) => ({
          turn: manifest.turn,
          ...(current ? { current: true } : {}),
          totalFiles: manifest.files.length,
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
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
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
      const raw = repository.kind === 'git'
        ? await porcelainStatus(repository)
        : { branch: '', files: [] }
      if (typeof selected === 'object') {
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
      const selectedFiles = raw.files.filter(file => selected === 'uncommitted'
        || (selected === 'staged' ? file.index !== ' ' && file.index !== '?' : file.workingTree !== ' ' || file.index === '?'))
      const files = await publicStatusFiles(repository, selectedFiles)
      return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: raw.branch, scope: selected, location: { repository: repository.location }, files }
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
        const baseline = await head(repository) ?? await emptyTree(repository)
        const raw = await porcelainStatus(repository)
        const selectedRows = raw.files
          .filter(file => selected === 'uncommitted'
            || (selected === 'staged' ? file.index !== ' ' && file.index !== '?' : file.workingTree !== ' ' || file.index === '?'))
        files = await publicStatusFiles(repository, selectedRows)
        if (selected === 'staged') {
          startTree = baseline
          endTree = await indexTree(repository)
        } else if (selected === 'unstaged') {
          startTree = await indexTree(repository)
          endTree = await snapshotWorktree(repository)
        } else {
          startTree = baseline
          endTree = await snapshotWorktree(repository)
        }
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
      const raw = await porcelainStatus(repository)
      const status = raw.files.find(file => file.path === rel || file.oldPath === rel)
      const oldPath = status?.oldPath ?? rel
      const kind = status === undefined ? 'file' : await fileKind(repository, status)
      const hintedPresentation = status === undefined ? 'unknown' : await statusPresentation(repository, status, kind)
      if (kind === 'repository' || kind === 'submodule') return {
        ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, scope: selected,
        location: { repository: repository.location }, path: rel, kind, presentation: kind,
        lineStatsState: 'not-applicable', layers: [],
      }
      let patch = ''
      let layerKind: ReviewPatchLayer['kind']
      const baseline = await head(repository) ?? await emptyTree(repository)
      const stagedTree = await indexTree(repository)
      const liveTree = selected === 'staged' ? stagedTree : await snapshotWorktree(repository)
      if (selected === 'staged') {
        patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', baseline, stagedTree, '--', oldPath, rel])
        layerKind = 'staged'
      } else if (selected === 'unstaged') {
        patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', stagedTree, liveTree, '--', oldPath, rel])
        layerKind = 'working-tree'
      } else {
        patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', baseline, liveTree, '--', oldPath, rel])
        layerKind = 'uncommitted'
      }
      const binary = patch.includes('GIT binary patch') || patch.includes('Binary files ')
      const oldText = binary ? null : selected === 'unstaged'
        ? await gitText(repository, ':', oldPath) : await gitText(repository, 'HEAD', oldPath)
      const newText = binary ? null : selected === 'staged'
        ? await gitText(repository, ':', rel) : await worktreeText(repository, rel)
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
      const turns = (await Promise.all(completed.map(row => this.reconcile(repository, row))))
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
