import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceUpload } from '../src/workspace-file-policy.ts'

describe('resolveWorkspaceUpload', () => {
  it('accepts only regular non-symlink files inside the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-upload-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-browser-outside-'))
    await writeFile(join(root, 'ok.txt'), 'ok')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await mkdir(join(root, 'folder'))
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    await expect(resolveWorkspaceUpload(root, 'ok.txt')).resolves.toBe(await realpath(join(root, 'ok.txt')))
    await expect(resolveWorkspaceUpload(root, join(outside, 'secret.txt'))).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(resolveWorkspaceUpload(root, '../missing.txt')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(resolveWorkspaceUpload(root, 'folder')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(resolveWorkspaceUpload(root, 'link.txt')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
  })
})
