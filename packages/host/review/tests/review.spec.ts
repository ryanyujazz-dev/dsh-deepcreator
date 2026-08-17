import { execFile } from 'node:child_process'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
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
        kind: 'working-tree',
        oldSource: { revision: 'index', text: 'before\n' },
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
    await expect(review.diff(session, 'new name.txt')).resolves.toMatchObject({
      ok: true, path: 'new name.txt', oldPath: 'old name.txt',
      layers: [{ kind: 'staged', oldSource: { revision: 'head', text: 'content\n' }, newSource: { revision: 'index', text: 'content\n' } }],
    })
  })

  it('keeps staged and working-tree snapshots in separate ordered layers', async () => {
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

    await expect(review.diff(session, 'layered.ts')).resolves.toMatchObject({
      ok: true,
      layers: [
        {
          kind: 'staged',
          oldSource: { revision: 'head', text: 'export const value = "head"\n' },
          newSource: { revision: 'index', text: 'export const value = "index"\n' },
        },
        {
          kind: 'working-tree',
          oldSource: { revision: 'index', text: 'export const value = "index"\n' },
          newSource: { revision: 'worktree', text: 'export const value = "worktree"\n' },
        },
      ],
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
    expect(binary).toMatchObject({ ok: true, layers: [{ kind: 'working-tree' }] })
    expect(binary.ok && binary.layers[0]?.patch).toContain('Binary files')
    const untracked = await review.diff(session, 'new file.ts')
    expect(untracked).toMatchObject({
      ok: true,
      layers: [{
        kind: 'working-tree',
        oldSource: { revision: 'index', text: null },
        newSource: { revision: 'worktree', text: 'export const ready = true\n' },
      }],
    })
    expect(untracked.ok && untracked.layers[0]?.patch).toContain('+export const ready = true')
  })
})
