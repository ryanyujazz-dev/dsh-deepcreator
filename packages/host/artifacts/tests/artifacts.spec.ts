import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARTIFACT_PRESENTATION_PROMPT, ARTIFACT_RESOLVER_DESCRIPTION, ArtifactReader,
} from '../src/index.ts'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('ArtifactReader', () => {
  it('gives the Agent explicit, selective artifact presentation guidance', async () => {
    const ctx = new Context()
    new SystemPrompt(ctx, {})
    new ArtifactReader(ctx)

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections).toContainEqual({
      name: 'deepcreator:artifact-presentation',
      text: ARTIFACT_PRESENTATION_PROMPT,
    })
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('proactively present one primary user-consumable artifact')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('Do not open ordinary source files')
    expect(ARTIFACT_PRESENTATION_PROMPT).toContain('do not reopen a resource')
    expect(ARTIFACT_RESOLVER_DESCRIPTION).toContain('present the primary output once')
  })

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
    // Windows directory symlinks need Developer Mode or admin; junctions do
    // not, and resolve to the same canonical target the reader must accept.
    await symlink(workspace, linked, process.platform === 'win32' ? 'junction' : undefined)
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
