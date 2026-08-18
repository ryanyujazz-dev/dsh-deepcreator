import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactReader } from '../src/index.ts'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('ArtifactReader', () => {
  it('reads workspace files by absolute or relative path', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    await writeFile(join(workspace, 'plan.md'), '# plan')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(new Context())
    await expect(reader.read(session, join(workspace, 'plan.md'))).resolves.toMatchObject({ ok: true, content: '# plan' })
    await expect(reader.read(session, 'plan.md')).resolves.toMatchObject({ ok: true, content: '# plan' })
  })

  it('reads absolute paths that carry a symlinked workspace prefix', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const linkedRoot = await mkdtemp(join(tmpdir(), 'dsh-artifacts-linked-')); temporary.push(linkedRoot)
    const linked = join(linkedRoot, 'link')
    await symlink(workspace, linked)
    await writeFile(join(workspace, 'plan.md'), '# plan')
    const session = { id: 's1', header: { cwd: linked } } as unknown as Session
    const reader = new ArtifactReader(new Context())
    await expect(reader.read(session, join(linked, 'plan.md'))).resolves.toMatchObject({ ok: true, content: '# plan' })
  })

  it('rejects paths that escape the canonical workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-artifacts-outside-')); temporary.push(outside)
    await writeFile(join(outside, 'secret.md'), 'secret')
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(new Context())
    await expect(reader.read(session, join(outside, 'secret.md'))).resolves.toMatchObject({ ok: false, code: 'OUTSIDE_WORKSPACE' })
    await expect(reader.read(session, '../escape.md')).resolves.toMatchObject({ ok: false, code: 'OUTSIDE_WORKSPACE' })
  })

  it('reports missing files and sessions without a workspace explicitly', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const session = { id: 's1', header: { cwd: workspace } } as unknown as Session
    const reader = new ArtifactReader(new Context())
    await expect(reader.read(session, 'missing.md')).resolves.toMatchObject({ ok: false, code: 'NOT_FOUND' })
    await expect(reader.read({ id: 's1', header: {} } as unknown as Session, 'a.md')).resolves.toMatchObject({ ok: false, code: 'NO_WORKSPACE' })
  })
})
