/**
 * The runtime asset channel (B9/B10): name/extension/magic-byte gates,
 * workspace fencing, per-asset and per-app quotas, idempotent upsert,
 * listing with quota usage, and the uninstall wipe.
 * @module @ryanyujazz/dsh-app-stage/tests/assets.spec
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assetUrl, assetsDir, listAssets, removeAssets, writeAsset } from '../src/assets.ts'

const roots: string[] = []
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))) })

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])
const MP4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(64)])

async function workspace(): Promise<{ home: string; ws: string }> {
  const root = await mkdtemp(join(tmpdir(), 'appstage-assets-'))
  roots.push(root)
  await mkdir(join(root, 'out'), { recursive: true })
  return { home: root, ws: join(root, 'ws') === undefined ? root : root }
}

describe('app_asset_write gates', () => {
  let home: string
  let ws: string
  beforeAll(async () => {
    const made = await workspace()
    home = made.home
    ws = made.home
    await writeFile(join(ws, 'out', 'sunset.png'), PNG)
    await writeFile(join(ws, 'out', 'clip.mp4'), MP4)
    await writeFile(join(ws, 'out', 'fake.png'), JPEG)
    await writeFile(join(ws, 'out', 'note.txt'), Buffer.from('text'))
  })

  it('writes a sniffed png and reports the receipt with quota', async () => {
    const written = await writeAsset(home, 'canvas', 'sunset.png', 'out/sunset.png', ws)
    expect(written).toEqual({
      ok: true,
      result: {
        ok: true, appId: 'canvas', name: 'sunset.png',
        url: assetUrl('canvas', 'sunset.png'), mediaType: 'image/png',
        bytes: PNG.length, overwritten: false, quotaUsedBytes: PNG.length,
      },
    })
  })

  it('overwrites by name idempotently and flips overwritten', async () => {
    await writeFile(join(ws, 'out', 'sunset.png'), Buffer.concat([PNG, Buffer.alloc(16)]))
    const second = await writeAsset(home, 'canvas', 'sunset.png', 'out/sunset.png', ws)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.result.overwritten).toBe(true)
      expect(second.result.bytes).toBe(PNG.length + 16)
    }
  })

  it('rejects renamed files (magic bytes must match the extension)', async () => {
    const result = await writeAsset(home, 'canvas', 'fake.png', 'out/fake.png', ws)
    expect(result).toEqual({ ok: false, code: 'MIME_UNSUPPORTED', message: expect.stringContaining('sniffing') })
  })

  it('rejects non-whitelisted extensions and names', async () => {
    expect((await writeAsset(home, 'canvas', 'note.txt', 'out/note.txt', ws)).ok).toBe(false)
    expect((await writeAsset(home, 'canvas', '../escape.png', 'out/sunset.png', ws)).ok).toBe(false)
    const slash = await writeAsset(home, 'canvas', 'a/b.png', 'out/sunset.png', ws)
    expect(slash.ok).toBe(false)
  })

  it('rejects absolute and escaping source paths', async () => {
    const absolute = await writeAsset(home, 'canvas', 'x.png', '/etc/hostname', ws)
    expect(absolute).toEqual({ ok: false, code: 'SOURCE_PATH_INVALID', message: expect.any(String) })
    const escape = await writeAsset(home, 'canvas', 'x.png', '../outside.png', ws)
    expect(escape.ok).toBe(false)
  })

  it('reports a missing source as SOURCE_NOT_FOUND', async () => {
    const result = await writeAsset(home, 'canvas', 'gone.png', 'out/gone.png', ws)
    expect(result).toEqual({ ok: false, code: 'SOURCE_NOT_FOUND', message: expect.any(String) })
  })

  it('accepts mp4 video with the ftyp box', async () => {
    const result = await writeAsset(home, 'canvas', 'clip.mp4', 'out/clip.mp4', ws)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.result.mediaType).toBe('video/mp4')
  })
})

describe('app_asset_list and the uninstall wipe', () => {
  it('lists sorted with quota usage, then wipes clean', async () => {
    const made = await workspace()
    const { home, ws } = made
    await writeFile(join(ws, 'b.png'), PNG)
    await writeFile(join(ws, 'a.png'), PNG)
    await writeAsset(home, 'gallery', 'b.png', 'b.png', ws)
    await writeAsset(home, 'gallery', 'a.png', 'a.png', ws)
    const listed = await listAssets(home, 'gallery')
    expect(listed.assets.map(asset => asset.name)).toEqual(['a.png', 'b.png'])
    expect(listed.quotaUsedBytes).toBe(PNG.length * 2)
    expect(listed.assets[0]!.url).toBe('/deepcreator-app-stage/assets/gallery/a.png')
    await removeAssets(home, 'gallery')
    expect(await listAssets(home, 'gallery')).toEqual({ assets: [], quotaUsedBytes: 0, quotaLimitBytes: 256 * 1024 * 1024 })
    expect(assetsDir(home, 'ghost')).toContain(join('deepcreator', 'apps', 'assets', 'ghost'))
  })
})
