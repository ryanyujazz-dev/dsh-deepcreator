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
    await expect(review.diff(session, 'file.txt')).resolves.toMatchObject({ ok: true, path: 'file.txt' })
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
      files: [{ index: 'R', workingTree: ' ', path: 'new name.txt' }],
    })
    await expect(review.diff(session, 'new name.txt')).resolves.toMatchObject({ ok: true, path: 'new name.txt' })
  })
})
