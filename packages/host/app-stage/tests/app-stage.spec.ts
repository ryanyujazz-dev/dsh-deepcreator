import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensurePreset, gateDevEntry, scanDevRoot, validateManifestBytes, APP_STAGE_PRESET_ID } from '../src/index.ts'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'app-stage-'))
}

const validManifest = {
  id: 'kanban', platform: 'app-stage-v1', name: '任务看板', version: '0.1.0',
  description: '给 agent 和人共用的任务看板', entry: 'index.html',
  agentGuide: 'AGENT.md', dataVersion: '1',
  actions: [
    { name: 'createTask', description: '在指定列新建卡片，title 为卡片标题文本，column 为目标列名', persist: ['board'], params: { title: 'string', column: 'string?' } },
  ],
}

async function writeApp(root: string, manifest: unknown, files: readonly string[] = ['index.html', 'AGENT.md']): Promise<string> {
  const id = (manifest as { id: string }).id
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  for (const file of files) await writeFile(join(dir, file), 'x')
  await writeFile(join(dir, 'app.json'), JSON.stringify(manifest))
  return dir
}

describe('manifest v1 validation', () => {
  const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

  it('accepts the canonical manifest and applies defaults', () => {
    const result = validateManifestBytes('kanban', bytes(validManifest))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.entry).toBe('index.html')
    expect(result.manifest.dev).toBe(false)
    expect(result.manifest.actions[0]!.params).toEqual({ title: 'string', column: 'string?' })
    expect(result.manifest.permissions).toEqual([])
  })

  it('rejects id/directory disagreement and bad platform distinctly', () => {
    const mismatch = validateManifestBytes('other', bytes(validManifest))
    expect(mismatch).toMatchObject({ ok: false, reason: { code: 'manifest.invalid' } })
    const platform = validateManifestBytes('kanban', bytes({ ...validManifest, platform: 'app-stage-v2' }))
    expect(platform).toMatchObject({ ok: false, reason: { code: 'platform.unsupported' } })
  })

  it('rejects escaping paths, reserved permissions, and malformed actions', () => {
    for (const patch of [
      { entry: '../outside.html' }, { icon: '/abs.png' }, { permissions: ['net'] },
      { actions: [{ name: 'not-camel', description: 'x' }] },
      { actions: [{ name: 'a', description: 'x', params: { p: 'array' } }] },
      { actions: [{ name: 'a', description: 'x', persist: ['bad key!'] }] },
    ]) {
      const result = validateManifestBytes('kanban', bytes({ ...validManifest, ...patch }))
      expect(result).toMatchObject({ ok: false, reason: { code: 'manifest.invalid' } })
    }
  })

  it('rejects oversized manifests by bytes', () => {
    const big = new TextEncoder().encode(`${JSON.stringify(validManifest).slice(0, -1)},"pad":"${'x'.repeat(70_000)}"}`)
    expect(validateManifestBytes('kanban', big)).toMatchObject({ ok: false, reason: { code: 'manifest.invalid' } })
  })
})

describe('dev gate', () => {
  it('ready for a complete app, incomplete for missing declared files', async () => {
    const root = await tempRoot()
    const dir = await writeApp(root, validManifest)
    expect(await gateDevEntry(dir, 'kanban', false)).toMatchObject({ status: 'ready', conflictsWithInstalled: false })
    await writeFile(join(dir, 'app.json'), JSON.stringify({ ...validManifest, icon: 'icon.svg' }))
    const gated = await gateDevEntry(dir, 'kanban', true)
    expect(gated.status).toBe('incomplete')
    expect(gated.reason).toMatchObject({ code: 'gate.incomplete' })
    expect(gated.conflictsWithInstalled).toBe(true)
  })

  it('scan yields one gated entry per directory and skips dot dirs', async () => {
    const workspace = await tempRoot()
    const root = join(workspace, '.deepcreator', 'apps')
    await writeApp(root, validManifest)
    await mkdir(join(root, '.deepcreator-backup'), { recursive: true })
    const entries = await scanDevRoot(workspace, new Set(['kanban']))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ appId: 'kanban', conflictsWithInstalled: true })
  })
})

describe('agent preset materializer', () => {
  it('materializes, verifies, and heals a tampered composition', async () => {
    const home = await tempRoot()
    const warnings: string[] = []
    const log = (message: string) => { warnings.push(message) }
    expect(await ensurePreset(join(home, '.agent-presets'), log)).toBe('materialized')
    expect(await ensurePreset(join(home, '.agent-presets'), log)).toBe('verified')
    expect(warnings).toEqual([])
    const composition = join(home, '.agent-presets', APP_STAGE_PRESET_ID, 'agent.cordis.yml')
    await writeFile(composition, '- id: evil\n', 'utf8')
    expect(await ensurePreset(join(home, '.agent-presets'), log)).toBe('healed')
    expect(warnings[0]).toContain('tampered')
    const healed = await readFile(composition, 'utf8')
    expect(healed).toContain('- id: app-stage-agent')
    expect(healed).toMatch(/name: 'file:\/\//)
  })
})
