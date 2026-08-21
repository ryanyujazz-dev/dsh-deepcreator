import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewService } from '../src/index.ts'

const exec = promisify(execFile)
const temporary: string[] = []
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
})
