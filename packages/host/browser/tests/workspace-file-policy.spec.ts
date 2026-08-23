import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveWorkspaceUpload } from '../src/workspace-file-policy.ts'

/** Windows without Developer Mode/admin lacks SeCreateSymbolicLinkPrivilege and fails symlink(). */
function canCreateSymlinks(): boolean {
  const probe = join(tmpdir(), `dsh-symlink-probe-${process.pid}`)
  const target = join(probe, 'target')
  try {
    mkdirSync(probe, { recursive: true })
    writeFileSync(target, 'probe')
    symlinkSync(target, join(probe, 'link'))
    return true
  } catch { return false }
  finally { rmSync(probe, { recursive: true, force: true }) }
}
const symlinksAvailable = canCreateSymlinks()

describe('resolveWorkspaceUpload', () => {
  it('accepts regular files and rejects outside, traversal, and directory targets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-upload-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-browser-outside-'))
    await writeFile(join(root, 'ok.txt'), 'ok')
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await mkdir(join(root, 'folder'))
    await expect(resolveWorkspaceUpload(root, 'ok.txt')).resolves.toBe(await realpath(join(root, 'ok.txt')))
    await expect(resolveWorkspaceUpload(root, join(outside, 'secret.txt'))).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(resolveWorkspaceUpload(root, '../missing.txt')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
    await expect(resolveWorkspaceUpload(root, 'folder')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
  })

  it.runIf(symlinksAvailable)('rejects a symlink whose target escapes the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-browser-upload-'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-browser-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'))
    await expect(resolveWorkspaceUpload(root, 'link.txt')).rejects.toMatchObject({ code: 'NAVIGATION_BLOCKED' })
  })
})
