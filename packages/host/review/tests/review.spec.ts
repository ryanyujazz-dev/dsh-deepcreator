import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewService } from '../src/index.ts'

const exec = promisify(execFile)
const temporary: string[] = []

function emitSessionEvent(ctx: Context, session: Session, type: string): void {
  const emitter = ctx as unknown as {
    emit(name: 'session/event', target: Session, event: {
      type: string
      seq: number
      time: number
      data: Record<string, never>
    }): void
  }
  emitter.emit('session/event', session, { type, seq: 1, time: Date.now(), data: {} })
}

async function gitTraceCommandCount(path: string, command: string): Promise<number> {
  const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean)
  return lines.filter(line => {
    const event: unknown = JSON.parse(line)
    if (typeof event !== 'object' || event === null) return false
    const candidate = event as { event?: unknown; argv?: unknown }
    return candidate.event === 'start' && Array.isArray(candidate.argv) && candidate.argv.includes(command)
  }).length
}

// Windows host global core.autocrlf=true would convert the temp repos' files
// to CRLF and break exact-content assertions; pin every git subprocess this
// test process spawns (including the ReviewService under test) to LF.
process.env.GIT_CONFIG_COUNT = '1'
process.env.GIT_CONFIG_KEY_0 = 'core.autocrlf'
process.env.GIT_CONFIG_VALUE_0 = 'false'
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('Review Service', () => {
  it('captures current and completed turn diffs for a non-Git workspace without creating .git', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-review-filesystem-')); temporary.push(workspace)
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-review-home-')); temporary.push(dshHome)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = dshHome
    try {
      const canonicalWorkspace = await realpath(workspace)
      const session = { id: 'filesystem-session', header: { cwd: workspace } } as unknown as Session
      const review = new ReviewService(new Context())
      const capture = review as unknown as {
        captureStart(session: Session, turn: number): Promise<void>
        captureEnd(session: Session, turn: number): Promise<void>
      }

      await capture.captureStart(session, 4)
      await writeFile(join(workspace, 'notes.md'), '# live\n')

      await expect(review.history(session)).resolves.toMatchObject({
        ok: true,
        repositoryRoot: canonicalWorkspace,
        workspaceKind: 'filesystem',
        turns: [{ turn: 4, current: true, remainingFiles: 1, undoable: false }],
      })
      await expect(review.status(session, { turn: 4 })).resolves.toMatchObject({
        ok: true, workspaceKind: 'filesystem', files: [{ path: 'notes.md' }],
      })
      await expect(review.diff(session, 'notes.md', { turn: 4 })).resolves.toMatchObject({
        ok: true,
        workspaceKind: 'filesystem',
        layers: [{
          kind: 'turn',
          oldSource: { revision: 'turn-start', text: null },
          newSource: { revision: 'turn-end', text: '# live\n' },
        }],
      })

      await capture.captureEnd(session, 4)
      const restarted = new ReviewService(new Context())
      await expect(restarted.history(session)).resolves.toMatchObject({
        ok: true,
        workspaceKind: 'filesystem',
        turns: [{ turn: 4, remainingFiles: 1, undoable: false }],
      })
      const completed = await restarted.history(session)
      expect(completed.ok && completed.turns[0]?.current).toBeUndefined()
      await expect(restarted.status(session, 'uncommitted')).resolves.toMatchObject({
        ok: true, workspaceKind: 'filesystem', files: [],
      })
      await expect(readFile(join(workspace, '.git'), 'utf8')).rejects.toBeDefined()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('excludes private DSH snapshot state when it lives inside a filesystem workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-review-contained-home-')); temporary.push(workspace)
    const dshHome = join(workspace, '.dsh-state')
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = dshHome
    try {
      const session = { id: 'contained-home-session', header: { cwd: workspace } } as unknown as Session
      const review = new ReviewService(new Context())
      const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void> }

      await capture.captureStart(session, 2)
      await writeFile(join(workspace, 'notes.md'), '# safe\n')

      await expect(review.status(session, { turn: 2 })).resolves.toMatchObject({
        ok: true,
        files: [{ path: 'notes.md' }],
      })
      const history = await review.history(session)
      expect(history.ok && history.turns[0]?.files.map(file => file.path)).toEqual(['notes.md'])
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('projects read-only status and fences diff paths to the canonical repository', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', 'file.txt'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await writeFile(join(repository, 'file.txt'), 'after\n')
    const session = { id: 's1', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    await expect(review.status(session)).resolves.toMatchObject({ ok: true, files: [{ path: 'file.txt' }] })
    await expect(review.diff(session, 'file.txt')).resolves.toMatchObject({
      ok: true,
      path: 'file.txt',
      layers: [{
        kind: 'uncommitted',
        oldSource: { revision: 'head', text: 'before\n' },
        newSource: { revision: 'worktree', text: 'after\n' },
      }],
    })
    await expect(review.diff(session, '../secret')).resolves.toMatchObject({ ok: false, code: 'OUTSIDE_REPOSITORY' })
  })

  it('preserves spaces and exposes the destination path for renamed files', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'old name.txt'), 'content\n')
    await exec('git', ['-C', repository, 'add', 'old name.txt'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await rename(join(repository, 'old name.txt'), join(repository, 'new name.txt'))
    await exec('git', ['-C', repository, 'add', '-A'])
    const session = { id: 's1', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    await expect(review.status(session)).resolves.toMatchObject({
      ok: true,
      files: [{ index: 'R', workingTree: ' ', path: 'new name.txt', oldPath: 'old name.txt' }],
    })
    await expect(review.diff(session, 'new name.txt', 'staged')).resolves.toMatchObject({
      ok: true, path: 'new name.txt', oldPath: 'old name.txt',
      layers: [{ kind: 'staged', oldSource: { revision: 'head', text: 'content\n' }, newSource: { revision: 'index', text: 'content\n' } }],
    })
    await expect(review.summary(session, 'staged')).resolves.toMatchObject({
      ok: true,
      files: [{ path: 'new name.txt', oldPath: 'old name.txt', additions: 0, deletions: 0, binary: false }],
    })
  })

  it('exposes staged, unstaged and merged uncommitted ranges independently', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'layered.ts'), 'export const value = "head"\n')
    await exec('git', ['-C', repository, 'add', 'layered.ts'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await writeFile(join(repository, 'layered.ts'), 'export const value = "index"\n')
    await exec('git', ['-C', repository, 'add', 'layered.ts'])
    await writeFile(join(repository, 'layered.ts'), 'export const value = "worktree"\n')
    const session = { id: 's1', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    await expect(review.diff(session, 'layered.ts', 'staged')).resolves.toMatchObject({
      ok: true,
      layers: [{
          kind: 'staged',
          oldSource: { revision: 'head', text: 'export const value = "head"\n' },
          newSource: { revision: 'index', text: 'export const value = "index"\n' },
      }],
    })
    await expect(review.diff(session, 'layered.ts', 'unstaged')).resolves.toMatchObject({
      ok: true,
      layers: [{
          kind: 'working-tree',
          oldSource: { revision: 'index', text: 'export const value = "index"\n' },
          newSource: { revision: 'worktree', text: 'export const value = "worktree"\n' },
      }],
    })
    await expect(review.diff(session, 'layered.ts')).resolves.toMatchObject({
      ok: true,
      layers: [{
        kind: 'uncommitted',
        oldSource: { revision: 'head', text: 'export const value = "head"\n' },
        newSource: { revision: 'worktree', text: 'export const value = "worktree"\n' },
      }],
    })
    await expect(review.summary(session, 'staged')).resolves.toMatchObject({ additions: 1, deletions: 1 })
    await expect(review.summary(session, 'unstaged')).resolves.toMatchObject({ additions: 1, deletions: 1 })
    await expect(review.summary(session, 'uncommitted')).resolves.toMatchObject({ additions: 1, deletions: 1 })
  })

  it('shares one live Git tree across a status refresh wave and replaces it on the next status', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-shared-tree-')); temporary.push(repository)
    const traceDirectory = await mkdtemp(join(tmpdir(), 'dsh-review-trace-')); temporary.push(traceDirectory)
    const tracePath = join(traceDirectory, 'git.jsonl')
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await writeFile(join(repository, 'file.txt'), 'wave one\n')
    const session = { id: 'shared-tree', header: { cwd: repository } } as unknown as Session
    const ctx = new Context()
    const review = new ReviewService(ctx)
    const previousTrace = process.env.GIT_TRACE2_EVENT
    process.env.GIT_TRACE2_EVENT = tracePath

    try {
      await expect(review.status(session)).resolves.toMatchObject({ ok: true, files: [{ path: 'file.txt' }] })
      expect(await gitTraceCommandCount(tracePath, 'add')).toBe(0)
      await expect(review.summary(session)).resolves.toMatchObject({ ok: true, additions: 1, deletions: 1 })
      expect(await gitTraceCommandCount(tracePath, 'add')).toBe(1)
      await writeFile(join(repository, 'file.txt'), 'wave two\n')

      emitSessionEvent(ctx, session, 'assistant/chunk')
      await expect(review.diff(session, 'file.txt')).resolves.toMatchObject({
        ok: true,
        layers: [{
          oldSource: { text: 'before\n' },
          newSource: { text: 'wave one\n' },
        }],
      })
      expect(await gitTraceCommandCount(tracePath, 'add')).toBe(1)

      await expect(review.status(session)).resolves.toMatchObject({ ok: true, files: [{ path: 'file.txt' }] })
      await expect(review.diff(session, 'file.txt')).resolves.toMatchObject({
        ok: true,
        layers: [{ newSource: { text: 'wave two\n' } }],
      })
      expect(await gitTraceCommandCount(tracePath, 'add')).toBe(2)
    } finally {
      if (previousTrace === undefined) delete process.env.GIT_TRACE2_EVENT
      else process.env.GIT_TRACE2_EVENT = previousTrace
    }
  })

  it('summarizes a scope without loading per-file source snapshots', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'tracked.ts'), 'one\ntwo\n')
    await writeFile(join(repository, 'renamed.ts'), 'same\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await writeFile(join(repository, 'tracked.ts'), 'one\nchanged\nthree\n')
    await rename(join(repository, 'renamed.ts'), join(repository, 'moved.ts'))
    await writeFile(join(repository, 'new.ts'), 'new\nfile\n')
    await writeFile(join(repository, 'image.bin'), Buffer.from([0, 1, 2, 3]))
    const session = { id: 'summary', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    await expect(review.summary(session, 'uncommitted')).resolves.toMatchObject({
      ok: true,
      additions: 4,
      deletions: 1,
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'tracked.ts', additions: 2, deletions: 1, binary: false }),
        expect.objectContaining({ path: 'new.ts', additions: 2, deletions: 0, binary: false }),
        expect.objectContaining({ path: 'image.bin', additions: 0, deletions: 0, binary: true }),
      ]),
    })
  })

  it('merges exact tool edits into one generation and serves source lazily', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-generation-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'generation-session', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const internals = review as unknown as {
      captureStart(session: Session, turn: number): Promise<void>
      ensureTracker(session: Session, turn: number): Promise<unknown>
      rootCallTurns: Map<string, number>
      turnTrackers: Map<string, { dirty: boolean; dirtyReason?: string; root: string }>
      generations: Map<string, { snapshot?: () => Promise<unknown> }>
      toolResultValue(result: unknown): unknown
      observeToolResult(execution: unknown, result: unknown): void
    }
    await internals.captureStart(session, 7)
    await internals.ensureTracker(session, 7)
    expect(internals.turnTrackers.get(`generation-session\0${7}`)?.dirtyReason).toBeUndefined()
    internals.rootCallTurns.set('generation-session\0root-call', 7)
    const execution = { agent: { session }, rootCallId: 'root-call', name: 'edit' }

    await writeFile(join(repository, 'file.txt'), 'middle\n')
    const firstResult = {
      isError: false, value: { path: 'file.txt', before: 'before\n', after: 'middle\n' },
    }
    expect(internals.toolResultValue(firstResult)).toEqual(firstResult.value)
    expect(internals.turnTrackers.get(`generation-session\0${7}`)?.root).toBe(await realpath(repository))
    internals.observeToolResult(execution, firstResult)
    expect(internals.turnTrackers.get(`generation-session\0${7}`)?.dirtyReason).toBeUndefined()
    await writeFile(join(repository, 'file.txt'), 'final\n')
    internals.observeToolResult(execution, {
      isError: false, value: { path: 'file.txt', before: 'middle\n', after: 'final\n' },
    })

    const manifest = await review.manifest(session, { turn: 7 })
    expect(manifest).toMatchObject({
      ok: true, consistency: 'live-exact', files: [{ path: 'file.txt', lineStatsState: 'pending' }],
    })
    if (!manifest.ok) throw new Error(manifest.message)
    const patches = await review.patches(session, manifest.generation, ['file.txt'])
    if (!patches.ok) throw new Error(patches.message)
    expect(patches).toMatchObject({
      ok: true,
      files: [{ path: 'file.txt', additions: 1, deletions: 1, layers: [{ oldRevision: 'turn-start', newRevision: 'turn-end' }] }],
    })
    expect(patches.ok && patches.files[0]?.layers[0]?.patch).toContain('-before')
    expect(patches.ok && patches.files[0]?.layers[0]?.patch).toContain('+final')
    await expect(review.source(session, manifest.generation, 'file.txt', 'old')).resolves.toMatchObject({ ok: true, text: 'before\n' })
    await expect(review.source(session, manifest.generation, 'file.txt', 'new')).resolves.toMatchObject({ ok: true, text: 'final\n' })
    await expect(review.patches(session, 'missing-generation', ['file.txt'])).resolves.toMatchObject({
      ok: false, code: 'STALE_GENERATION',
    })

    const workspaceManifest = await review.manifest(session)
    if (!workspaceManifest.ok) throw new Error(workspaceManifest.message)
    const workspaceGeneration = internals.generations.get(workspaceManifest.generation)
    const authoritative = workspaceGeneration?.snapshot
    expect(authoritative).toBeTypeOf('function')
    if (authoritative === undefined) throw new Error('Expected a lazy authoritative snapshot.')
    const snapshot = vi.fn(authoritative)
    if (workspaceGeneration !== undefined) workspaceGeneration.snapshot = snapshot
    const workspacePatch = await review.patches(session, workspaceManifest.generation, ['file.txt'])
    expect(workspacePatch.ok && workspacePatch.files[0]?.layers[0]?.patch).toContain('+final')
    expect(snapshot).not.toHaveBeenCalled()
    await expect(review.source(session, workspaceManifest.generation, 'file.txt', 'new')).resolves.toMatchObject({ text: 'final\n' })
    expect(snapshot).not.toHaveBeenCalled()

    await writeFile(join(repository, 'file.txt'), 'before\n')
    internals.observeToolResult(execution, {
      isError: false, value: { path: 'file.txt', before: 'final\n', after: 'before\n' },
    })
    await expect(review.manifest(session, { turn: 7 })).resolves.toMatchObject({
      ok: true, consistency: 'live-exact', files: [],
    })
  })

  it('computes one cached path batch for many files without per-file Git processes', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-batch-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    const paths = Array.from({ length: 500 }, (_, index) => `file-${String(index).padStart(3, '0')}.txt`)
    await Promise.all(paths.map(async path => { await writeFile(join(repository, path), 'before\n') }))
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await Promise.all(paths.map(async path => { await writeFile(join(repository, path), 'after\n') }))
    const traceDirectory = await mkdtemp(join(tmpdir(), 'dsh-review-trace-')); temporary.push(traceDirectory)
    const tracePath = join(traceDirectory, 'trace.json')
    const previousTrace = process.env.GIT_TRACE2_EVENT
    process.env.GIT_TRACE2_EVENT = tracePath
    try {
      const session = { id: 'batch-session', header: { cwd: repository } } as unknown as Session
      const review = new ReviewService(new Context())
      const manifest = await review.manifest(session)
      if (!manifest.ok) throw new Error(manifest.message)
      expect(manifest.files).toHaveLength(paths.length)
      const result = await review.patches(session, manifest.generation, paths)
      expect(result.ok && result.files).toHaveLength(paths.length)
      expect(result.ok && result.files.every(file => file.layers.length === 1)).toBe(true)
      if (result.ok) {
        for (const file of result.files) expect(file.layers[0]?.patch).toContain(file.path)
        expect(result.files.every(file => file.layers.every(layer => !('oldSource' in layer) && !('newSource' in layer)))).toBe(true)
        expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(512 * 1024)
      }
      // The second request reuses the generation path cache and starts no new
      // per-file Git work.
      const before = await gitTraceCommandCount(tracePath, 'diff')
      await review.patches(session, manifest.generation, paths.slice(0, 5))
      expect(await gitTraceCommandCount(tracePath, 'diff')).toBe(before)
      expect(before).toBeLessThanOrEqual(3)
      const catFilesBefore = await gitTraceCommandCount(tracePath, 'cat-file')
      const sources = await Promise.all(paths.slice(0, 5).map(async path => await review.source(session, manifest.generation, path, 'old')))
      expect(sources.every(source => source.ok && source.text === 'before\n')).toBe(true)
      const catFilesAfter = await gitTraceCommandCount(tracePath, 'cat-file')
      expect(catFilesAfter - catFilesBefore).toBe(1)
      await Promise.all(paths.slice(0, 5).map(async path => await review.source(session, manifest.generation, path, 'old')))
      expect(await gitTraceCommandCount(tracePath, 'cat-file')).toBe(catFilesAfter)
      await review.deleteSessionSnapshots(session)
    } finally {
      if (previousTrace === undefined) delete process.env.GIT_TRACE2_EVENT
      else process.env.GIT_TRACE2_EVENT = previousTrace
    }
  })

  it('returns explicit patches for untracked text and binary changes', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'image.bin'), Buffer.from([0, 1, 2, 3]))
    await exec('git', ['-C', repository, 'add', 'image.bin'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await writeFile(join(repository, 'image.bin'), Buffer.from([0, 9, 8, 7]))
    await writeFile(join(repository, 'new file.ts'), 'export const ready = true\n')
    const session = { id: 's1', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    const binary = await review.diff(session, 'image.bin')
    expect(binary).toMatchObject({ ok: true, layers: [{ kind: 'uncommitted' }] })
    expect(binary.ok && binary.layers[0]?.patch).toContain('Binary files')
    const untracked = await review.diff(session, 'new file.ts')
    expect(untracked).toMatchObject({
      ok: true,
      layers: [{
        kind: 'uncommitted',
        oldSource: { revision: 'head', text: null },
        newSource: { revision: 'worktree', text: 'export const ready = true\n' },
      }],
    })
    expect(untracked.ok && untracked.layers[0]?.patch).toContain('+export const ready = true')
  })

  it('treats untracked files in an unborn repository as unstaged and uncommitted', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await writeFile(join(repository, 'chat_agent.py'), 'print("ready")\n')
    const session = { id: 's-unborn', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    await expect(review.status(session, 'unstaged')).resolves.toMatchObject({
      ok: true, files: [{ path: 'chat_agent.py', index: '?', workingTree: '?' }],
    })
    await expect(review.status(session, 'staged')).resolves.toMatchObject({ ok: true, files: [] })
    await expect(review.status(session)).resolves.toMatchObject({
      ok: true, files: [{ path: 'chat_agent.py', index: '?', workingTree: '?' }],
    })
    await expect(review.diff(session, 'chat_agent.py')).resolves.toMatchObject({
      ok: true,
      layers: [{
        kind: 'uncommitted',
        oldSource: { revision: 'head', text: null },
        newSource: { revision: 'worktree', text: 'print("ready")\n' },
      }],
    })
  })

  it('compares staged and edited files against an empty tree in an unborn repository', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await writeFile(join(repository, 'chat_agent.py'), 'print("staged")\n')
    await exec('git', ['-C', repository, 'add', 'chat_agent.py'])
    await writeFile(join(repository, 'chat_agent.py'), 'print("worktree")\n')
    const session = { id: 's-unborn-staged', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    await expect(review.diff(session, 'chat_agent.py', 'staged')).resolves.toMatchObject({
      ok: true,
      layers: [{
        kind: 'staged',
        oldSource: { revision: 'head', text: null },
        newSource: { revision: 'index', text: 'print("staged")\n' },
      }],
    })
    await expect(review.diff(session, 'chat_agent.py', 'unstaged')).resolves.toMatchObject({
      ok: true,
      layers: [{
        kind: 'working-tree',
        oldSource: { revision: 'index', text: 'print("staged")\n' },
        newSource: { revision: 'worktree', text: 'print("worktree")\n' },
      }],
    })
    const uncommitted = await review.diff(session, 'chat_agent.py')
    expect(uncommitted).toMatchObject({
      ok: true,
      layers: [{
        kind: 'uncommitted',
        oldSource: { revision: 'head', text: null },
        newSource: { revision: 'worktree', text: 'print("worktree")\n' },
      }],
    })
    expect(uncommitted.ok && uncommitted.layers[0]?.patch).toContain('+print("worktree")')
  })

  it('persists one history record per changed turn and omits zero-change turns', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }

    await capture.captureStart(session, 1)
    await capture.captureEnd(session, 1)
    await capture.captureStart(session, 2)
    await writeFile(join(repository, 'file.txt'), 'after\n')
    await writeFile(join(repository, 'new.txt'), 'new\n')
    await capture.captureEnd(session, 2)

    // Simulate an active ref written before diff counts were persisted. Its
    // retained boundary trees must be enough for history() to backfill them.
    const ref = 'refs/deepcreator/turns/session-test/2'
    const { stdout: endTree } = await exec('git', ['-C', repository, 'show', '-s', '--format=%T', ref])
    const { stdout: parent } = await exec('git', ['-C', repository, 'show', '-s', '--format=%P', ref])
    const { stdout: message } = await exec('git', ['-C', repository, 'show', '-s', '--format=%B', ref])
    const legacy = JSON.parse(message.trim()) as { files: Array<{ additions?: number; deletions?: number }> }
    for (const file of legacy.files) { delete file.additions; delete file.deletions }
    const { stdout: legacyCommit } = await exec('git', [
      '-C', repository, 'commit-tree', endTree.trim(), '-p', parent.trim(), '-m', JSON.stringify(legacy),
    ])
    await exec('git', ['-C', repository, 'update-ref', ref, legacyCommit.trim()])

    await expect(review.history(session)).resolves.toMatchObject({
      ok: true,
      turns: [{
        turn: 2, totalFiles: 2, remainingFiles: 2, additions: 2, deletions: 1, state: 'active', undoable: true,
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'file.txt', additions: 1, deletions: 1 }),
          expect.objectContaining({ path: 'new.txt', additions: 1, deletions: 0 }),
        ]),
      }],
    })
    await expect(review.summary(session, { turn: 2 })).resolves.toMatchObject({
      ok: true, additions: 2, deletions: 1,
      files: expect.arrayContaining([
        expect.objectContaining({ path: 'file.txt', additions: 1, deletions: 1 }),
        expect.objectContaining({ path: 'new.txt', additions: 1, deletions: 0 }),
      ]),
    })
    await expect(review.diff(session, 'file.txt', { turn: 2 })).resolves.toMatchObject({
      ok: true,
      scope: { turn: 2 },
      layers: [{
        kind: 'turn',
        oldSource: { revision: 'turn-start', text: 'before\n' },
        newSource: { revision: 'turn-end', text: 'after\n' },
      }],
    })
  })

  it('keeps reconciliation results across non-mutating session events', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-reconcile-cache-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'reconcile-cache', header: { cwd: repository } } as unknown as Session
    const ctx = new Context()
    const review = new ReviewService(ctx)
    const capture = review as unknown as {
      captureStart(session: Session, turn: number): Promise<void>
      captureEnd(session: Session, turn: number): Promise<void>
    }
    const internals = review as unknown as { reconcileCache: Map<string, unknown> }
    await capture.captureStart(session, 1)
    await writeFile(join(repository, 'file.txt'), 'after\n')
    await capture.captureEnd(session, 1)

    await expect(review.history(session)).resolves.toMatchObject({
      ok: true,
      turns: [{ turn: 1, remainingFiles: 1 }],
    })
    expect(internals.reconcileCache.size).toBe(1)

    emitSessionEvent(ctx, session, 'assistant/chunk')
    expect(internals.reconcileCache.size).toBe(1)
    await expect(review.history(session)).resolves.toMatchObject({
      ok: true,
      turns: [{ turn: 1, remainingFiles: 1 }],
    })
    expect(internals.reconcileCache.size).toBe(1)
  })

  it('tracks partial external commits without resolving a still-dirty file', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'a.txt'), 'a0\n')
    await writeFile(join(repository, 'b.txt'), 'b0\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 3)
    await writeFile(join(repository, 'a.txt'), 'a1\n')
    await writeFile(join(repository, 'b.txt'), 'b1\n')
    await capture.captureEnd(session, 3)
    await exec('git', ['-C', repository, 'add', 'a.txt'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'partial'])

    const history = await review.history(session)
    expect(history).toMatchObject({ ok: true, turns: [{ turn: 3, remainingFiles: 1, state: 'mixed' }] })
    if (!history.ok) return
    expect(history.turns[0]?.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'a.txt', state: 'committed' }),
      expect.objectContaining({ path: 'b.txt', state: 'pending' }),
    ]))
  })

  it('removes a historical scope directly after an external commit', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 10)
    await writeFile(join(repository, 'file.txt'), 'after\n')
    await capture.captureEnd(session, 10)
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'external'])

    // No history() poll precedes the status request: selecting TURN 10 must
    // still reconcile HEAD and discard its fully committed record immediately.
    await expect(review.status(session, { turn: 10 })).resolves.toMatchObject({
      ok: false, code: 'TURN_NOT_FOUND',
    })
    await expect(review.history(session)).resolves.toMatchObject({
      ok: true, turns: [],
    })
    await expect(exec('git', ['-C', repository, 'rev-parse', '--verify', 'refs/deepcreator/turns/session-test/10']))
      .rejects.toThrow()
  })

  it('undoes only the newest active turn and preserves non-conflicting later edits', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'value=before\nkeep=1\nkeep=2\nkeep=3\nkeep=4\nmanual=before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 4)
    await writeFile(join(repository, 'file.txt'), 'value=after\nkeep=1\nkeep=2\nkeep=3\nkeep=4\nmanual=before\n')
    await capture.captureEnd(session, 4)
    await writeFile(join(repository, 'file.txt'), 'value=after\nkeep=1\nkeep=2\nkeep=3\nkeep=4\nmanual=later\n')

    await expect(review.undoTurn(session, 4)).resolves.toMatchObject({ ok: true, revertedFiles: ['file.txt'] })
    await expect(readFile(join(repository, 'file.txt'), 'utf8')).resolves.toBe('value=before\nkeep=1\nkeep=2\nkeep=3\nkeep=4\nmanual=later\n')
    await expect(review.history(session)).resolves.toMatchObject({
      ok: true, turns: [{ turn: 4, remainingFiles: 0, state: 'reverted', undoable: false }],
    })
  })

  it('omits a change record when every change was committed inside the turn', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 5)
    await writeFile(join(repository, 'file.txt'), 'after\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'turn commit'])
    await capture.captureEnd(session, 5)

    await expect(review.history(session)).resolves.toMatchObject({
      ok: true, turns: [],
    })
    await expect(review.diff(session, 'file.txt', { turn: 5 })).resolves.toMatchObject({
      ok: false, code: 'TURN_NOT_FOUND',
    })
    await expect(exec('git', ['-C', repository, 'rev-parse', '--verify', 'refs/deepcreator/turns/session-test/5']))
      .rejects.toThrow()
  })

  it('clears a turn captured before the first commit once its files enter HEAD', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    const session = { id: 'session-unborn-history', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 1)
    await writeFile(join(repository, 'chat_agent.py'), 'print("ready")\n')
    await capture.captureEnd(session, 1)
    await exec('git', ['-C', repository, 'add', 'chat_agent.py'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])

    await expect(review.history(session)).resolves.toMatchObject({ ok: true, turns: [] })
  })

  it('clears a retained generated file that becomes ignored after the turn', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, '.gitignore'), '')
    await exec('git', ['-C', repository, 'add', '.gitignore'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await mkdir(join(repository, '__pycache__'))
    await writeFile(join(repository, '__pycache__', 'chat_agent.pyc'), 'generated')
    const session = { id: 'session-ignore-history', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 2)
    await writeFile(join(repository, '__pycache__', 'chat_agent.pyc'), 'changed generated output')
    await capture.captureEnd(session, 2)
    await writeFile(join(repository, '.gitignore'), '__pycache__/\n')
    await exec('git', ['-C', repository, 'add', '.gitignore'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'ignore generated files'])

    await expect(review.history(session)).resolves.toMatchObject({ ok: true, turns: [] })
  })

  it('rejects a conflicting undo without changing the worktree or real index', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'value=before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 6)
    await writeFile(join(repository, 'file.txt'), 'value=turn\n')
    await capture.captureEnd(session, 6)
    await writeFile(join(repository, 'file.txt'), 'value=manual\n')
    const { stdout: indexBefore } = await exec('git', ['-C', repository, 'write-tree'])

    await expect(review.undoTurn(session, 6)).resolves.toMatchObject({ ok: false, code: 'CONFLICT' })
    await expect(readFile(join(repository, 'file.txt'), 'utf8')).resolves.toBe('value=manual\n')
    const { stdout: indexAfter } = await exec('git', ['-C', repository, 'write-tree'])
    expect(indexAfter).toBe(indexBefore)
  })

  it('removes its private refs when a session is deleted', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'before\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 7)
    await writeFile(join(repository, 'file.txt'), 'after\n')
    await capture.captureEnd(session, 7)
    await review.deleteSessionSnapshots(session)
    const { stdout } = await exec('git', ['-C', repository, 'for-each-ref', '--format=%(refname)', 'refs/deepcreator/turns/session-test/'])
    expect(stdout).toBe('')
  })

  it('resolves consecutive turns on the same file through a later fast-forward commit', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'file.txt'), 'v0\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    const session = { id: 'session-test', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 8)
    await writeFile(join(repository, 'file.txt'), 'v1\n')
    await capture.captureEnd(session, 8)
    await capture.captureStart(session, 9)
    await writeFile(join(repository, 'file.txt'), 'v2\n')
    await capture.captureEnd(session, 9)
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'both turns'])

    await expect(review.history(session)).resolves.toMatchObject({
      ok: true,
      turns: [],
    })
  })
  it('expands ordinary untracked directories but drills into nested repositories as atomic entries', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-nested-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'root.txt'), 'root\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'initial'])
    await mkdir(join(repository, 'plain', 'deep'), { recursive: true })
    await writeFile(join(repository, 'plain', 'deep', 'note.md'), '# note\n')
    const nested = join(repository, 'nested repo')
    await mkdir(nested)
    await exec('git', ['init', '-q', nested])
    await writeFile(join(nested, 'child.txt'), 'child\n')
    const session = { id: 'nested-status', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    const root = await review.status(session)
    expect(root).toMatchObject({ ok: true })
    expect(root.ok && root.branch).not.toContain('...')
    expect(root.ok && root.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'plain/deep/note.md', kind: 'file' }),
      expect.objectContaining({ path: 'nested repo', kind: 'repository', presentation: 'repository' }),
    ]))
    expect(root.ok && root.files.some(file => file.path === 'nested repo/child.txt')).toBe(false)
    await expect(review.diff(session, 'plain\\deep\\note.md')).resolves.toMatchObject({
      ok: true, path: 'plain/deep/note.md', layers: [{ newSource: { text: '# note\n' } }],
    })
    await expect(review.diff(session, 'nested repo')).resolves.toMatchObject({
      ok: true, kind: 'repository', presentation: 'repository', lineStatsState: 'not-applicable', layers: [],
    })
    await expect(review.status(session, 'uncommitted', { repository: 'nested repo' })).resolves.toMatchObject({
      ok: true, location: { repository: 'nested repo' }, files: [{ path: 'child.txt' }],
    })
    await expect(review.diff(session, 'child.txt', 'uncommitted', { repository: 'nested repo' })).resolves.toMatchObject({
      ok: true, path: 'child.txt', layers: [{ kind: 'uncommitted', newSource: { text: 'child\n' } }],
    })
  })

  it('captures and reconciles one Turn across root and nested repositories independently', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-cross-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'root.txt'), 'root 0\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'root initial'])
    const nested = join(repository, 'nested')
    await mkdir(nested)
    await exec('git', ['init', '-q', nested])
    await exec('git', ['-C', nested, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', nested, 'config', 'user.name', 'Test'])
    await writeFile(join(nested, 'child.txt'), 'child 0\n')
    await exec('git', ['-C', nested, 'add', '.'])
    await exec('git', ['-C', nested, 'commit', '-qm', 'child initial'])
    const session = { id: 'cross-repository', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }

    await capture.captureStart(session, 12)
    await writeFile(join(repository, 'root.txt'), 'root 1\n')
    await writeFile(join(nested, 'child.txt'), 'child 1\n')
    await capture.captureEnd(session, 12)
    await expect(review.history(session)).resolves.toMatchObject({
      ok: true,
      turns: [{
        turn: 12, remainingFiles: 2, undoable: false, undoDisabledReason: 'cross-repository',
        files: expect.arrayContaining([
          expect.objectContaining({ path: 'root.txt', repository: '', repositoryPath: 'root.txt' }),
          expect.objectContaining({ path: 'nested/child.txt', repository: 'nested', repositoryPath: 'child.txt' }),
        ]),
      }],
    })
    await expect(review.status(session, { turn: 12 }, { repository: 'nested' })).resolves.toMatchObject({
      ok: true, files: [{ path: 'child.txt', repository: 'nested' }],
    })
    await expect(review.diff(session, 'child.txt', { turn: 12 }, { repository: 'nested' })).resolves.toMatchObject({
      ok: true, path: 'child.txt', layers: [{ kind: 'turn' }],
    })

    await exec('git', ['-C', repository, 'add', 'root.txt'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'root change'])
    await expect(review.history(session)).resolves.toMatchObject({ ok: true, turns: [{ remainingFiles: 1 }] })
    await exec('git', ['-C', nested, 'add', 'child.txt'])
    await exec('git', ['-C', nested, 'commit', '-qm', 'child change'])
    await expect(review.history(session)).resolves.toMatchObject({ ok: true, turns: [] })
  })

  it('shows a symlink target without reading a target outside the workspace', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-link-')); temporary.push(repository)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-review-outside-')); temporary.push(outside)
    await exec('git', ['init', '-q', repository])
    await writeFile(join(outside, 'secret.txt'), 'must not be exposed\n')
    await symlink(join(outside, 'secret.txt'), join(repository, 'external-link'))
    const session = { id: 'symlink', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const result = await review.diff(session, 'external-link')
    expect(result).toMatchObject({ ok: true, kind: 'symlink' })
    expect(result.ok && result.layers[0]?.newSource.text).toBe(join(outside, 'secret.txt'))
    expect(result.ok && result.layers[0]?.newSource.text).not.toContain('must not be exposed')
  })

  it('keeps protected undo available for a Turn owned by one nested repository', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-child-undo-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await writeFile(join(repository, 'root.txt'), 'root\n')
    await exec('git', ['-C', repository, 'add', '.'])
    await exec('git', ['-C', repository, 'commit', '-qm', 'root'])
    const nested = join(repository, 'nested')
    await mkdir(nested)
    await exec('git', ['init', '-q', nested])
    await exec('git', ['-C', nested, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', nested, 'config', 'user.name', 'Test'])
    await writeFile(join(nested, 'child.txt'), 'before\n')
    await exec('git', ['-C', nested, 'add', '.'])
    await exec('git', ['-C', nested, 'commit', '-qm', 'child'])
    const session = { id: 'child-undo', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())
    const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
    await capture.captureStart(session, 3)
    await writeFile(join(nested, 'child.txt'), 'after\n')
    await capture.captureEnd(session, 3)
    await expect(review.history(session)).resolves.toMatchObject({ ok: true, turns: [{ undoable: true }] })
    await expect(review.undoTurn(session, 3)).resolves.toMatchObject({ ok: true, revertedFiles: ['nested/child.txt'] })
    expect(await readFile(join(nested, 'child.txt'), 'utf8')).toBe('before\n')
    expect((await exec('git', ['-C', repository, 'diff', '--cached', '--name-only'])).stdout).toBe('')
  })

  it('keeps a dirty submodule atomic and marks line statistics as not applicable', async () => {
    const source = await mkdtemp(join(tmpdir(), 'dsh-review-submodule-source-')); temporary.push(source)
    await exec('git', ['init', '-q', source])
    await exec('git', ['-C', source, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', source, 'config', 'user.name', 'Test'])
    await writeFile(join(source, 'child.txt'), 'before\n')
    await exec('git', ['-C', source, 'add', '.'])
    await exec('git', ['-C', source, 'commit', '-qm', 'initial'])
    const repository = await mkdtemp(join(tmpdir(), 'dsh-review-submodule-parent-')); temporary.push(repository)
    await exec('git', ['init', '-q', repository])
    await exec('git', ['-C', repository, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', repository, 'config', 'user.name', 'Test'])
    await exec('git', ['-c', 'protocol.file.allow=always', '-C', repository, 'submodule', 'add', '-q', source, 'modules/child'])
    await exec('git', ['-C', repository, 'commit', '-qam', 'submodule'])
    await writeFile(join(repository, 'modules', 'child', 'child.txt'), 'after\n')
    const session = { id: 'submodule', header: { cwd: repository } } as unknown as Session
    const review = new ReviewService(new Context())

    await expect(review.status(session)).resolves.toMatchObject({
      ok: true, files: [{ path: 'modules/child', kind: 'submodule', presentation: 'submodule' }],
    })
    await expect(review.summary(session)).resolves.toMatchObject({
      ok: true, additions: 0, deletions: 0,
      files: [{ path: 'modules/child', kind: 'submodule', presentation: 'submodule', lineStatsState: 'not-applicable' }],
    })
  })

  it('attributes nested repository files inside a non-Git workspace to their owning repository', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-review-filesystem-nested-')); temporary.push(workspace)
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-review-filesystem-nested-home-')); temporary.push(dshHome)
    const nested = join(workspace, 'projects', 'child')
    await mkdir(nested, { recursive: true })
    await exec('git', ['init', '-q', nested])
    await exec('git', ['-C', nested, 'config', 'user.email', 'test@example.com'])
    await exec('git', ['-C', nested, 'config', 'user.name', 'Test'])
    await writeFile(join(nested, 'child.txt'), 'before\n')
    await exec('git', ['-C', nested, 'add', '.'])
    await exec('git', ['-C', nested, 'commit', '-qm', 'initial'])
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = dshHome
    try {
      const session = { id: 'filesystem-nested', header: { cwd: workspace } } as unknown as Session
      const review = new ReviewService(new Context())
      const capture = review as unknown as { captureStart(session: Session, turn: number): Promise<void>; captureEnd(session: Session, turn: number): Promise<void> }
      await capture.captureStart(session, 7)
      await writeFile(join(nested, 'child.txt'), 'after\n')
      await capture.captureEnd(session, 7)
      await expect(review.history(session)).resolves.toMatchObject({
        ok: true,
        workspaceKind: 'filesystem',
        turns: [{ files: [{ path: 'projects/child/child.txt', repository: 'projects/child', repositoryPath: 'child.txt' }] }],
      })
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })
}, 30000)
