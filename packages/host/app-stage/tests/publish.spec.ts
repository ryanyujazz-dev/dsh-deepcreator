/** Publish-gate machinery: version policy, zero-external scan, snapshot
 * digest/cap, install-store commit + uninstall roundtrip. */
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  compareVersions, resolvePlan, scanZeroExternal, hashSnapshot, stageSnapshot,
  writeInstallPointer, commitSnapshot, uninstallApp, readStagedManifest, gateForPublish,
  PACKAGE_MAX_BYTES, appendHistory, readHistory, readWatermark, advanceWatermark,
  HISTORY_CAP, type AppHistoryRecord,
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
    const noWatermark = undefined
    expect(resolvePlan('0.1.0', undefined, 'f1', noWatermark, 'd1')).toBe('first')
    expect(resolvePlan('0.2.0', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f1', noWatermark, 'd1')).toBe('update-same-source')
    expect(resolvePlan('0.2.0', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f2', noWatermark, 'd1')).toBe('update-cross-source')
    expect(resolvePlan('0.1.0', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f1', noWatermark, 'd1')).toEqual({ code: 'VERSION_NOT_BUMPED' })
    expect(resolvePlan('0.0.9', { version: '0.1.0', sourceFingerprint: 'f1' }, 'f1', noWatermark, 'd1')).toEqual({ code: 'VERSION_DOWNGRADED' })
  })

  it('watermark closes the rollback-republish hole without self-locking (M6a)', () => {
    const installed = { version: '0.1.0', sourceFingerprint: 'f1' }
    const watermark = { version: '0.3.0', digest: 'd3' }
    // Rolled back to 0.1.0, then a genuine fix 0.4.0 ABOVE the watermark: flows normally (no F1 self-lock).
    expect(resolvePlan('0.4.0', installed, 'f1', watermark, 'd4')).toBe('update-same-source')
    // Republishing 0.2.0 (at/below watermark, digest history never saw): hard approval.
    expect(resolvePlan('0.2.0', installed, 'f1', watermark, 'd2-new')).toBe('update-below-watermark')
    // Same number as an already-shipped digest: idempotent fast lane.
    expect(resolvePlan('0.3.0', installed, 'f1', watermark, 'd3', new Map([['0.3.0', 'd3']]))).toBe('update-same-source')
    // Same number, different code than history vouches for: hard approval (supply-chain guard).
    expect(resolvePlan('0.3.0', installed, 'f1', watermark, 'd3-evil', new Map([['0.3.0', 'd3']]))).toBe('update-below-watermark')
    // No watermark file yet (legacy installs): current-version comparison only.
    expect(resolvePlan('0.2.0', installed, 'f1', undefined, 'd2')).toBe('update-same-source')
  })

  it('history + watermark survive cap trimming and never regress on rollback (M6a)', async () => {
    const home = await tempHome()
    const record = (version: string, digest: string): AppHistoryRecord => ({
      appId: 'kanban-demo', version, digest, at: '2026-01-01T00:00:00Z',
      sourceWorkspace: 'ws', sourceFingerprint: 'f1', sourceSession: 's1', publishedVia: 'app_publish',
    })
    await writeInstallPointer('kanban-demo', { ...record('0.1.0', 'd1'), installedAt: '2026-01-01T00:00:00Z' }, home)
    await writeInstallPointer('kanban-demo', { ...record('0.2.0', 'd2'), installedAt: '2026-01-02T00:00:00Z' }, home)
    // Watermark moved to 0.2.0; history has both.
    expect((await readWatermark('kanban-demo', home))?.version).toBe('0.2.0')
    expect((await readHistory('kanban-demo', home)).map(item => item.version)).toEqual(['0.1.0', '0.2.0'])
    // A rollback append (publishedVia 'rollback') does NOT move the watermark.
    await appendHistory('kanban-demo', record('0.1.0', 'd1'), home)
    expect((await readWatermark('kanban-demo', home))?.version).toBe('0.2.0')
    // Cap: overflow trims oldest, FIFO.
    for (let i = 0; i < HISTORY_CAP + 5; i++) await appendHistory('kanban-demo', record(`9.0.${i}`, `d-${i}`), home)
    const kept = await readHistory('kanban-demo', home)
    expect(kept.length).toBe(HISTORY_CAP)
    expect(kept.at(0)!.version).toBe(`9.0.5`)
    // Uninstall wipes everything including the watermark (fresh baseline on reinstall).
    await uninstallApp('kanban-demo', home)
    expect(await readHistory('kanban-demo', home)).toEqual([])
    expect(await readWatermark('kanban-demo', home)).toBeUndefined()
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

  it('stages a snapshot, hashes it, and enforces the package cap mid-copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appstage-stage-'))
    const src = join(root, 'src')
    await mkdir(src)
    await writeFile(join(src, 'app.json'), '{}')
    const staged = await stageSnapshot(src, join(root, 'staged'))
    expect(staged.files).toEqual(['app.json'])
    expect(staged.symlinked).toEqual([])
    const { digest } = await hashSnapshot(join(root, 'staged'))
    expect(digest).toHaveLength(64)
    // Force the cap: the copy aborts on the oversized file itself.
    await writeFile(join(src, 'blob.bin'), Buffer.alloc(PACKAGE_MAX_BYTES + 1, 1))
    const oversized = await stageSnapshot(src, join(root, 'staged2'))
    expect('code' in oversized && oversized.code).toBe('PACKAGE_TOO_LARGE')
    // A partial staging tree must not survive an aborted copy.
    const staged2Exists = await stat(join(root, 'staged2')).then(() => true, () => false)
    expect(staged2Exists).toBe(false)
    await rm(root, { recursive: true, force: true })
  })

  it('never follows or copies symlinks and excludes .git/hidden/node_modules (M6a)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'appstage-symlink-'))
    const src = join(root, 'src')
    const secret = join(root, 'secret')
    await mkdir(join(src, '.git'), { recursive: true })
    await mkdir(join(src, 'node_modules/pkg'), { recursive: true })
    await mkdir(join(src, '.hidden'), { recursive: true })
    await writeFile(secret, 'HOST_SECRET')
    await writeFile(join(src, 'app.json'), '{}')
    await writeFile(join(src, '.git/config'), 'credentials')
    await writeFile(join(src, 'node_modules/pkg/index.js'), 'x')
    await writeFile(join(src, '.hidden/x'), 'x')
    await symlink(secret, join(src, 'leak'))
    await symlink('/etc/passwd', join(src, 'passwd'))
    const staged = await stageSnapshot(src, join(root, 'staged'))
    expect(staged.files).toEqual(['app.json'])
    expect([...staged.symlinked].sort()).toEqual(['leak', 'passwd'])
    // Nothing but app.json exists in the staging — no dereferenced secrets.
    const stagingFiles = await readdir(join(root, 'staged'))
    expect(stagingFiles.sort()).toEqual(['app.json'])
    const { digest, files } = await hashSnapshot(join(root, 'staged'))
    expect(files).toEqual(['app.json'])
    expect(digest).toHaveLength(64)
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
