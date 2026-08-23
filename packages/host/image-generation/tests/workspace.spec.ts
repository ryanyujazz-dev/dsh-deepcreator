import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeWorkspacePng } from '../src/workspace.ts'

describe('workspace image writes', () => {
  it('atomically writes a workspace-relative PNG', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-image-'))
    const relative = await writeWorkspacePng(root, 'generated/one.png', Uint8Array.from([1, 2, 3]))
    expect(relative).toBe(path.join('generated', 'one.png'))
    expect([...await readFile(path.join(root, relative))]).toEqual([1, 2, 3])
  })

  it('rejects escape paths and non-PNG destinations', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'dsh-image-'))
    await expect(writeWorkspacePng(root, '../outside.png', new Uint8Array())).rejects.toThrow('escapes')
    await expect(writeWorkspacePng(root, 'inside.jpg', new Uint8Array())).rejects.toThrow('end in .png')
  })
})
