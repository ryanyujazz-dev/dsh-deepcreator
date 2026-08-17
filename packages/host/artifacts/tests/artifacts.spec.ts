import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtifactRegistry, foldArtifacts } from '../src/index.ts'
import type { ArtifactRecord } from '../src/types.ts'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function record(id: string, path: string, updatedAt = 1): ArtifactRecord {
  return { id, sessionId: 's1', kind: 'plan', title: id, locator: { type: 'workspace-path', path }, revision: `r-${updatedAt}`, status: 'ready', createdAt: 1, updatedAt }
}

describe('Artifact Registry', () => {
  it('replays revisions, status changes and tombstones without copying content into events', () => {
    const first = record('a', 'plan.md')
    const revised = { ...first, title: 'Plan 2', revision: 'r2', updatedAt: 2 }
    const session = { id: 's1', events: [
      { seq: 1, time: 1, type: 'artifact/declared', data: { artifact: first } },
      { seq: 2, time: 2, type: 'artifact/revised', data: { artifact: revised } },
      { seq: 3, time: 3, type: 'artifact/status', data: { id: 'a', revision: 'r3', status: 'stale', updatedAt: 3 } },
    ] } as unknown as Session
    expect(foldArtifacts(session)).toEqual([{ ...revised, revision: 'r3', status: 'stale', updatedAt: 3 }])
  })

  it('reads workspace files and rejects paths that escape the canonical workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-artifacts-workspace-')); temporary.push(workspace)
    const outside = await mkdtemp(join(tmpdir(), 'dsh-artifacts-outside-')); temporary.push(outside)
    await writeFile(join(workspace, 'plan.md'), '# plan')
    await writeFile(join(outside, 'secret.md'), 'secret')
    const makeSession = (artifact: ArtifactRecord) => ({ id: 's1', header: { cwd: workspace }, events: [{ seq: 1, time: 1, type: 'artifact/declared', data: { artifact } }] }) as unknown as Session
    const registry = new ArtifactRegistry(new Context())
    await expect(registry.read(makeSession(record('inside', 'plan.md')), 'inside')).resolves.toMatchObject({ ok: true, content: '# plan' })
    await expect(registry.read(makeSession(record('outside', join(outside, 'secret.md'))), 'outside')).resolves.toMatchObject({ ok: false, code: 'OUTSIDE_WORKSPACE' })
  })
})
