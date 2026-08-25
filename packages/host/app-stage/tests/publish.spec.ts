/** Publish-gate machinery: version policy, zero-external scan, snapshot
 * digest/cap, install-store commit + uninstall roundtrip. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions, resolvePlan, scanZeroExternal, hashSnapshot, stageSnapshot,
  writeInstallPointer, commitSnapshot, uninstallApp, readStagedManifest, gateForPublish,
  PACKAGE_MAX_BYTES,
} from '../src/publish.ts'
import { readInstallPointer, readOpenedVersions, recordOpenedVersion } from '../src/store.ts'

async function tempHome(): Promise<string> { return mkdtemp(join(tmpdir(), 'appstage-pub-')) }

describe('publish machinery', () => {
  it('compares dotted versions numerically with lexical tail', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.9', '1.0')).toBeLessThan(0)
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0)
  })

  it('resolves the install plan: first, same-source, cross-source, frozen versions', () => {
    expect(resolvePlan('0.1.0', undefined, 'f1')).toBe('first')
    expect(resolvePlan('0.2.0', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f1')).toBe('update-same-source')
    expect(resolvePlan('0.2.0', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f2')).toBe('update-cross-source')
    expect(resolvePlan('0.1.0', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f1')).toEqual({ code: 'VERSION_NOT_BUMPED' })
    expect(resolvePlan('0.0.9', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f1')).toEqual({ code: 'VERSION_DOWNGRADED' })
  })

  it('scans absolute URLs and navigation APIs in text files only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'appstage-scan-'))
    await writeFile(join(dir, 'index.html'), '<script src="app.js"></script>')
    await writeFile(join(dir, 'app.js'), 'location.href = "x"; window.open("y")')
    await writeFile(join(dir, 'evil.css'), 'body { background: url(https://cdn.example/x.png) }')
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const { violations } = await scanZeroExternal(dir)
    const kinds = violations.map(item => `${item.file}:${item.kind}`).sort()
    expect(kinds).toContain('app.js:navigation-api')
    expect(kinds).toContain('evil.css:absolute-url')
    expect(violations.every(item => item.file !== 'index.html')).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })

  it('stages a snapshot, hashes it, and enforces the package cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appstage-stage-'))
    const src = join(root, 'src')
    await mkdir(src)
    await writeFile(join(src, 'app.json'), '{}')
    const staged = await stageSnapshot(src, join(root, 'staged'))
    expect(staged.files).toEqual(['app.json'])
    const { digest } = await hashSnapshot(join(root, 'staged'))
    expect(digest).toHaveLength(64)
    // Force the cap by writing one file larger than PACKAGE_MAX_BYTES.
    await writeFile(join(src, 'blob.bin'), Buffer.alloc(PACKAGE_MAX_BYTES + 1, 1))
    const oversized = await stageSnapshot(src, join(root, 'staged2'))
    expect('code' in oversized && oversized.code).toBe('PACKAGE_TOO_LARGE')
    await rm(root, { recursive: true, force: true })
  })

  it('commits a snapshot, writes the pointer, and uninstalls cleanly', async () => {
    const home = await tempHome()
    const staging = await mkdtemp(join(tmpdir(), 'appstage-commit-'))
    await writeFile(join(staging, 'app.json'), '{}')
    await writeFile(join(staging, 'index.html'), '<!doctype html>')
    await commitSnapshot(staging, 'kanban-demo', '0.2.0', home)
    await writeInstallPointer('kanban-demo', {
      version: '0.2.0', digest: 'd'.repeat(64), installedAt: '2026-01-01T00:00:00Z',
      sourceWorkspace: 'ws', sourceFingerprint: 'f1', sourceSession: 's1', publishedVia: 'app_publish',
    }, home)
    const pointer = await readInstallPointer('kanban-demo', home)
    expect(pointer?.version).toBe('0.2.0')
    expect(pointer?.sourceFingerprint).toBe('f1')
    expect(await readFile(join(home, 'deepcreator/apps/installed/kanban-demo/0.2.0/index.html'), 'utf8')).toContain('doctype')
    // Blue-dot bookkeeping.
    expect((await readOpenedVersions(home)).kanbanDemo).toBeUndefined()
    await recordOpenedVersion('kanban-demo', '0.2.0', home)
    expect((await readOpenedVersions(home))['kanban-demo']).toBe('0.2.0')
    // Uninstall removes snapshots + pointer + data + assets.
    await mkdir(join(home, 'deepcreator/apps/data/kanban-demo'), { recursive: true })
    const result = await uninstallApp('kanban-demo', home)
    expect('removed' in result).toBe(true)
    const again = await uninstallApp('kanban-demo', home)
    expect('code' in again && again.code).toBe('APP_NOT_INSTALLED')
    await rm(home, { recursive: true, force: true })
  })

  it('reads a staged manifest and gates missing workspace apps', async () => {
    const staging = await mkdtemp(join(tmpdir(), 'appstage-man-'))
    await writeFile(join(staging, 'app.json'), JSON.stringify({
      id: 'probe', platform: 'app-stage-v1', name: '探针', version: '0.1.0', entry: 'index.html', actions: [], permissions: [],
    }))
    const manifest = await readStagedManifest(staging, 'probe')
    expect(manifest?.name).toBe('探针')
    expect(manifest?.id).toBe('probe')
    const missing = await gateForPublish(staging, 'nope', false)
    expect('code' in missing && missing.code).toBe('APP_NOT_FOUND')
    await rm(staging, { recursive: true, force: true })
  })
})
