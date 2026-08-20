import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
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

    await expect(review.history(session)).resolves.toMatchObject({
      ok: true,
      turns: [{ turn: 2, totalFiles: 2, remainingFiles: 2, state: 'active', undoable: true }],
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

  it('recognizes a commit created inside the turn and tombstones its heavy snapshots', async () => {
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
      ok: true, turns: [{ turn: 5, remainingFiles: 0, state: 'committed', undoable: false }],
    })
    const ref = 'refs/deepcreator/turns/session-test/5'
    const { stdout: parents } = await exec('git', ['-C', repository, 'show', '-s', '--format=%P', ref])
    expect(parents.trim()).toBe('')
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
      turns: [
        { turn: 9, remainingFiles: 0, state: 'committed' },
        { turn: 8, remainingFiles: 0, state: 'committed' },
      ],
    })
  })
})
