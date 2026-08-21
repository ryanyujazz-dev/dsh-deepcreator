import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ReviewChecksResult, ReviewDiffResult, ReviewHistoryResult, ReviewPatchLayer, ReviewScope, ReviewWorkspaceKind,
  ReviewStatusResult, ReviewSummaryResult, ReviewTurnFile, ReviewTurnHistory, ReviewUndoTurnResult,
} from './types.ts'

export type {
  ReviewChecksResult, ReviewDiffResult, ReviewFileStatus, ReviewFileSummary, ReviewHistoryResult,
  ReviewPatchLayer, ReviewScope, ReviewSourceSnapshot, ReviewStatusResult, ReviewSummaryResult,
  ReviewTurnFile, ReviewTurnFileState, ReviewTurnHistory, ReviewUndoTurnResult, ReviewWorkspaceKind,
} from './types.ts'

const exec = promisify(execFile)
const MAX_BUFFER = 16 * 1024 * 1024
const REF_ROOT = 'refs/deepcreator/turns'

interface PorcelainFile { index: string; workingTree: string; path: string; oldPath?: string }
interface TurnManifest {
  version: 1
  sessionId: string
  turn: number
  phase: 'start' | 'end'
  head: string | null
  files: ReviewTurnFile[]
}
interface StoredTurn { ref: string; commit: string; tree: string; parent?: string; manifest: TurnManifest }
interface ReviewRepository {
  kind: ReviewWorkspaceKind
  /** Path exposed to the Client and used as the file-path boundary. */
  root: string
  /** Git object database root: the real repository or a DSH-owned bare repository. */
  repository: string
  /** Worktree used by filesystem snapshots; equal to root for both backends. */
  workspace: string
}

declare module '@deepseek-ai/cordis' { interface Context { review: ReviewService } }

class ReviewBoundaryError extends Error {
  constructor(readonly code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE', message: string) { super(message) }
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
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
    return { kind: 'git', root: repository, repository, workspace: repository }
  } catch (error) {
    if (error instanceof ReviewBoundaryError) throw error
  }
  const repository = filesystemRepositoryPath(session)
  await mkdir(resolve(repository, '..'), { recursive: true })
  try { await access(join(repository, 'HEAD')) }
  catch { await exec('git', ['init', '--bare', repository], { encoding: 'utf8', maxBuffer: MAX_BUFFER }) }
  return { kind: 'filesystem', root: workspace, repository, workspace }
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

async function gitDiff(repository: ReviewRepository, args: string[]): Promise<string> {
  try { return await git(repository, ['--literal-pathspecs', 'diff', ...args]) }
  catch (error) {
    const failure = error as { code?: number; stdout?: string }
    if (failure.code === 1 && typeof failure.stdout === 'string') return failure.stdout
    throw error
  }
}

function parsePorcelainStatus(stdout: string): { branch: string; files: PorcelainFile[] } {
  const records = stdout.split('\0')
  const branchRecord = records.shift() ?? ''
  const branch = branchRecord.startsWith('## ') ? branchRecord.slice(3) : ''
  const files: PorcelainFile[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record === '') continue
    const indexStatus = record[0] ?? ' '
    const workingTreeStatus = record[1] ?? ' '
    const firstPath = record.slice(3)
    if ('RC'.includes(indexStatus) || 'RC'.includes(workingTreeStatus)) {
      const previousPath = records[index + 1]
      if (previousPath !== undefined && previousPath !== '') {
        files.push({ index: indexStatus, workingTree: workingTreeStatus, path: firstPath, oldPath: previousPath })
        index += 1
        continue
      }
    }
    files.push({ index: indexStatus, workingTree: workingTreeStatus, path: firstPath })
  }
  return { branch, files }
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
    return { ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0 }) }
  })
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
    await git(repository, ['add', '-A', '--', '.'], { env })
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

async function partialReverseTree(repository: ReviewRepository, startTree: string, endTree: string, paths: string[]): Promise<string> {
  const patch = await gitDiff(repository, ['--binary', '--full-index', startTree, endTree, '--', ...paths])
  if (patch === '') return endTree
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-reverse-index-'))
  const indexPath = join(temporary, 'index')
  const patchPath = join(temporary, 'turn.patch')
  const env = { ...process.env, GIT_INDEX_FILE: indexPath }
  try {
    await writeFile(patchPath, patch)
    await git(repository, ['read-tree', endTree], { env })
    await git(repository, ['apply', '--cached', '--reverse', '--3way', patchPath], { env })
    return (await git(repository, ['write-tree'], { env })).trim()
  } finally { await rm(temporary, { recursive: true, force: true }) }
}

async function mergeTrees(repository: ReviewRepository, base: string, current: string, target: string): Promise<string | null> {
  try {
    const output = await git(repository, ['merge-tree', '--write-tree', '--merge-base', base, current, target])
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
  return row.version === 1 && typeof row.sessionId === 'string' && Number.isSafeInteger(row.turn)
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
    const canonical = await realpath(target)
    if (!isWithin(repository.root, canonical)) throw new ReviewBoundaryError('OUTSIDE_WORKSPACE', 'Review path resolves outside the workspace.')
    return await readFile(canonical, 'utf8')
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
      const tree = await snapshotWorktree(repository)
      await writeTurn(repository, ref, tree, {
        version: 1, sessionId: String(session.id), turn, phase: 'start', head: await head(repository), files: [],
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
        const tree = await snapshotWorktree(repository)
        const commit = await writeTurn(repository, ref, tree, {
          version: 1, sessionId: String(session.id), turn, phase: 'start', head: await head(repository), files: [],
        })
        start = await readTurn(repository, ref)
        if (start === null || start.commit !== commit) return
      }
      const endTree = await snapshotWorktree(repository)
      const files = parseNameStatus(await gitDiff(repository, ['--name-status', '-z', '--find-renames', start.tree, endTree]))
      if (files.length === 0) {
        await git(repository, ['update-ref', '-d', ref])
        return
      }
      const stats = parseNumstat(await gitDiff(repository, ['--numstat', '-z', '--find-renames', start.tree, endTree]))
      const measured = attachNumstat(files, stats)
      await writeTurn(repository, ref, endTree, {
        // Keep the start boundary's HEAD as the first reconciliation base so
        // a commit created inside this turn is recognized immediately.
        version: 1, sessionId: String(session.id), turn, phase: 'end', head: start.manifest.head, files: measured,
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
    const headChanged = stored.manifest.head !== currentHead
    const fastForward = stored.manifest.head === null
      ? currentHead !== null
      : currentHead !== null && await gitMaybe(repository, ['merge-base', '--is-ancestor', stored.manifest.head, currentHead]) !== null
    const changed = new Set<string>()
    if (headChanged && currentHead !== null) {
      const baseline = stored.manifest.head ?? await emptyTree(repository)
      const names = await gitDiff(repository, ['--name-only', '-z', baseline, currentHead])
      for (const name of names.split('\0')) if (name !== '') changed.add(name)
    }
    const porcelain = parsePorcelainStatus(await git(repository, ['status', '--porcelain=v1', '--branch', '-z'])).files
    const dirty = new Set(porcelain.flatMap(file => [file.path, ...(file.oldPath === undefined ? [] : [file.oldPath])]))
    let moved = false
    const files: ReviewTurnFile[] = []
    for (const file of stored.manifest.files) {
      if (file.state === 'reverted') { files.push(file); continue }
      if (file.state === 'committed' && !headChanged) { files.push(file); continue }
      const endObject = (await gitMaybe(repository, ['rev-parse', `${stored.tree}:${file.path}`]))?.trim() ?? null
      const headObject = currentHead === null ? null : (await gitMaybe(repository, ['rev-parse', `HEAD:${file.path}`]))?.trim() ?? null
      const touched = changed.has(file.path) || (file.oldPath !== undefined && changed.has(file.oldPath))
      const remainsDirty = dirty.has(file.path) || (file.oldPath !== undefined && dirty.has(file.oldPath))
      const ignored = file.state === 'pending'
        && await gitMaybe(repository, ['check-ignore', '-q', '--', file.path]) !== null
      // A later fast-forward commit of this path subsumes earlier turns even
      // when a newer turn changed the same file again. Amend/reset and other
      // non-fast-forward moves require the exact end object instead.
      // Exact tree equality and a newly ignored untracked path also resolve
      // generated files that no longer belong to Git's working change set.
      const state = !remainsDirty && (ignored || endObject === headObject || (touched && fastForward))
        ? 'committed' as const
        : 'pending' as const
      files.push(file.state === state ? file : { ...file, state })
      if (file.state !== state) moved = true
    }
    if (!moved) return stored
    const manifest: TurnManifest = { ...stored.manifest, head: currentHead, files }
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
    const endTree = await snapshotWorktree(repository)
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
      manifest: { ...start.manifest, phase: 'end', files: attachNumstat(files, stats) },
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
          undoable: repository.kind === 'git' && !current && manifest.turn === latestActive,
          files: manifest.files,
        })),
      }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('status')
  async status(session: Session, scope?: ReviewScope): Promise<ReviewStatusResult> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch (error) { return boundaryFailure(error) }
    try {
      const selected: ReviewScope = scope ?? 'uncommitted'
      if (repository.kind === 'filesystem' && typeof selected === 'string') {
        return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: '', scope: selected, files: [] }
      }
      const raw = repository.kind === 'git'
        ? parsePorcelainStatus(await git(repository, ['status', '--porcelain=v1', '--branch', '-z']))
        : { branch: '', files: [] }
      if (typeof selected === 'object') {
        const selectedTurn = await this.selectedTurn(session, repository, selected.turn)
        if (selectedTurn === null) return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${selected.turn} has no retained changes.` }
        const { stored } = selectedTurn
        const files = stored.manifest.files.filter(file => file.state === 'pending').map(file => ({
          path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }), index: ' ', workingTree: 'M',
        }))
        return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: raw.branch, scope: selected, files }
      }
      const files = raw.files.filter(file => selected === 'uncommitted'
        || (selected === 'staged' ? file.index !== ' ' && file.index !== '?' : file.workingTree !== ' ' || file.index === '?'))
      return { ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind, branch: raw.branch, scope: selected, files }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('summary')
  async summary(session: Session, scope?: ReviewScope): Promise<ReviewSummaryResult> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch (error) { return boundaryFailure(error) }
    try {
      const selected: ReviewScope = scope ?? 'uncommitted'
      if (repository.kind === 'filesystem' && typeof selected === 'string') {
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, additions: 0, deletions: 0, files: [],
        }
      }
      let startTree: string
      let endTree: string
      let files: Array<{ path: string; oldPath?: string }>
      if (typeof selected === 'object') {
        const selectedTurn = await this.selectedTurn(session, repository, selected.turn)
        const stored = selectedTurn?.stored
        if (stored === undefined || stored.parent === undefined) {
          return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${selected.turn} has no retained changes.` }
        }
        startTree = (await git(repository, ['show', '-s', '--format=%T', stored.parent])).trim()
        endTree = stored.tree
        files = stored.manifest.files
          .filter(file => file.state === 'pending')
          .map(file => ({ path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }) }))
      } else {
        const baseline = await head(repository) ?? await emptyTree(repository)
        const raw = parsePorcelainStatus(await git(repository, ['status', '--porcelain=v1', '--branch', '-z']))
        files = raw.files
          .filter(file => selected === 'uncommitted'
            || (selected === 'staged' ? file.index !== ' ' && file.index !== '?' : file.workingTree !== ' ' || file.index === '?'))
          .map(file => ({ path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }) }))
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
      }
      if (files.length === 0) {
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, additions: 0, deletions: 0, files: [],
        }
      }
      const paths = files.flatMap(file => [file.oldPath, file.path].filter((path): path is string => path !== undefined))
      const stats = parseNumstat(await gitDiff(repository, ['--numstat', '-z', '--find-renames', startTree, endTree, '--', ...paths]))
      const summarized = files.map(file => {
        const row = stats.get(file.path) ?? { additions: 0, deletions: 0, binary: false }
        return { ...file, ...row }
      })
      return {
        ok: true,
        repositoryRoot: repository.root,
        workspaceKind: repository.kind,
        scope: selected,
        additions: summarized.reduce((sum, file) => sum + file.additions, 0),
        deletions: summarized.reduce((sum, file) => sum + file.deletions, 0),
        files: summarized,
      }
    } catch (error) { return { ok: false, code: 'READ_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('diff')
  async diff(session: Session, path: string, scope?: ReviewScope): Promise<ReviewDiffResult> {
    let repository: ReviewRepository
    try { repository = await repositoryFor(session) } catch (error) { return boundaryFailure(error) }
    try {
      const selected: ReviewScope = scope ?? 'uncommitted'
      if (isAbsolute(path)) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path must be repository-relative.' }
      const target = resolve(repository.root, path)
      const rel = relative(repository.root, target)
      if (!isWithin(repository.root, target)) return { ok: false, code: 'OUTSIDE_REPOSITORY', message: 'Review path is outside the workspace.' }
      if (repository.kind === 'filesystem' && typeof selected === 'string') {
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, path: rel, layers: [],
        }
      }
      if (typeof selected === 'object') {
        const selectedTurn = await this.selectedTurn(session, repository, selected.turn)
        const stored = selectedTurn?.stored
        if (stored === undefined) return { ok: false, code: 'TURN_NOT_FOUND', message: `Turn ${selected.turn} has no retained changes.` }
        // A parentless record is a reverted tombstone. Its heavy start/end
        // snapshots have already been released, so the historical scope is
        // intentionally empty rather than an unavailable/error state.
        if (stored.parent === undefined) {
          return {
            ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
            scope: selected, path: rel, layers: [],
          }
        }
        const file = stored.manifest.files.find(file => file.path === rel || file.oldPath === rel)
        if (file === undefined || file.state !== 'pending') {
          return {
            ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
            scope: selected, path: rel, layers: [],
          }
        }
        const oldPath = file.oldPath ?? file.path
        const startTree = (await git(repository, ['show', '-s', '--format=%T', stored.parent])).trim()
        const patch = await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', startTree, stored.tree, '--', oldPath, file.path])
        const layers: ReviewPatchLayer[] = patch === '' ? [] : [{
          kind: 'turn', patch,
          oldSource: { revision: 'turn-start', text: await treeText(repository, startTree, oldPath) },
          newSource: { revision: 'turn-end', text: await treeText(repository, stored.tree, file.path) },
        }]
        return {
          ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
          scope: selected, path: file.path, ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath }), layers,
        }
      }
      const raw = parsePorcelainStatus(await git(repository, ['status', '--porcelain=v1', '--branch', '-z']))
      const status = raw.files.find(file => file.path === rel || file.oldPath === rel)
      const oldPath = status?.oldPath ?? rel
      const worktree = await worktreeText(repository, rel)
      const headSource = await gitText(repository, 'HEAD', oldPath)
      const indexSource = await gitText(repository, ':', rel)
      let patch = ''
      let layer: ReviewPatchLayer | undefined
      if (selected === 'staged') {
        patch = await gitDiff(repository, ['--cached', '--find-renames', '--find-copies', '--unified=3', '--', oldPath, rel])
        if (patch !== '') layer = { kind: 'staged', patch, oldSource: { revision: 'head', text: headSource }, newSource: { revision: 'index', text: indexSource } }
      } else if (selected === 'unstaged') {
        patch = status?.index === '?' && worktree !== null
          ? await gitDiff(repository, ['--no-index', '--unified=3', '--', '/dev/null', rel])
          : await gitDiff(repository, ['--find-renames', '--find-copies', '--unified=3', '--', oldPath, rel])
        if (patch !== '') layer = { kind: 'working-tree', patch, oldSource: { revision: 'index', text: indexSource }, newSource: { revision: 'worktree', text: worktree } }
      } else {
        const baseline = await head(repository) ?? await emptyTree(repository)
        patch = status?.index === '?' && worktree !== null
          ? await gitDiff(repository, ['--no-index', '--unified=3', '--', '/dev/null', rel])
          : await gitDiff(repository, [baseline, '--find-renames', '--find-copies', '--unified=3', '--', oldPath, rel])
        if (patch !== '') layer = { kind: 'uncommitted', patch, oldSource: { revision: 'head', text: headSource }, newSource: { revision: 'worktree', text: worktree } }
      }
      return {
        ok: true, repositoryRoot: repository.root, workspaceKind: repository.kind,
        scope: selected, path: rel, ...(oldPath === rel ? {} : { oldPath }), layers: layer === undefined ? [] : [layer],
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
      const startTree = (await git(repository, ['show', '-s', '--format=%T', stored.parent])).trim()
      const paths = pending.flatMap(file => [file.oldPath, file.path].filter((value): value is string => value !== undefined))
      const baselineHead = await head(repository)
      const baselineIndex = await indexTree(repository)
      const baselineWorktree = await snapshotWorktree(repository)
      const reverseTarget = await partialReverseTree(repository, startTree, stored.tree, paths)
      const nextIndex = await mergeTrees(repository, stored.tree, baselineIndex, reverseTarget)
      const nextWorktree = await mergeTrees(repository, stored.tree, baselineWorktree, reverseTarget)
      if (nextIndex === null || nextWorktree === null) {
        return { ok: false, code: 'CONFLICT', message: 'The files changed after this turn and cannot be safely undone.' }
      }
      // Re-read every moving repository boundary immediately before the first
      // real write. A terminal command racing this computation makes the
      // operation expire instead of being overwritten.
      if (await head(repository) !== baselineHead
        || await indexTree(repository) !== baselineIndex
        || await snapshotWorktree(repository) !== baselineWorktree) {
        return { ok: false, code: 'CONFLICT', message: 'The repository changed while preparing the undo. Try again.' }
      }
      const worktreePatch = await gitDiff(repository, ['--binary', '--full-index', baselineWorktree, nextWorktree])
      const temporary = await mkdtemp(join(tmpdir(), 'dsh-review-undo-'))
      const patchPath = join(temporary, 'worktree.patch')
      try {
        if (worktreePatch !== '') {
          await writeFile(patchPath, worktreePatch)
          try { await git(repository, ['apply', '--check', patchPath]) }
          catch { return { ok: false, code: 'CONFLICT', message: 'The prepared undo no longer applies cleanly.' } }
          await git(repository, ['apply', patchPath])
        }
        try { await git(repository, ['read-tree', nextIndex]) }
        catch (error) {
          if (worktreePatch !== '') await gitMaybe(repository, ['apply', '--reverse', patchPath])
          throw error
        }
      } finally { await rm(temporary, { recursive: true, force: true }) }
      const files = stored.manifest.files.map(file => file.state === 'pending' ? { ...file, state: 'reverted' as const } : file)
      const tree = await emptyTree(repository)
      await writeTurn(repository, stored.ref, tree, { ...stored.manifest, head: await head(repository), files })
      return { ok: true, repositoryRoot: repository.root, turn, revertedFiles: pending.map(file => file.path) }
    } catch (error) { return { ok: false, code: 'APPLY_FAILED', message: error instanceof Error ? error.message : String(error) } }
  }

  @Remote('checks')
  async checks(session: Session): Promise<ReviewChecksResult> {
    try {
      const repository = await repositoryFor(session)
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
