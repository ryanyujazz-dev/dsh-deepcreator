import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAppListTool, createAppManifestTool } from '../src/tools.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'

const validManifest = {
  id: 'kanban', platform: 'app-stage-v1', name: '任务看板', version: '0.2.0',
  description: '给 agent 和人共用的任务看板', entry: 'index.html',
  agentGuide: 'AGENT.md', dataVersion: '1',
  actions: [
    { name: 'createTask', description: '在指定列新建卡片，title 为卡片标题文本，column 为目标列名', persist: ['board'], params: { title: 'string', column: 'string?' } },
  ],
}

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'app-agent-'))
}

/** Fake install store: pointer + version snapshot dir. */
async function installApp(home: string, manifest: typeof validManifest, guide = '# 指南\n工作流：createTask 后回读验证。'): Promise<void> {
  const dir = join(home, 'deepcreator/apps/installed', manifest.id, manifest.version)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'app.json'), JSON.stringify(manifest))
  await writeFile(join(dir, 'index.html'), '<p>kanban</p>')
  if (guide !== '') await writeFile(join(dir, 'AGENT.md'), guide)
  await writeFile(join(home, 'deepcreator/apps/installed', manifest.id, 'current.json'), JSON.stringify({
    appId: manifest.id, version: manifest.version, digest: 'deadbeef', installedAt: '2026-01-01T00:00:00Z',
    sourceWorkspace: '/ws/alpha', sourceFingerprint: 'fp-1', sourceSession: 's-1', publishedVia: 'app_publish',
  }))
}

function execFor(cwd?: string): ToolRunContext {
  const agent = { session: { header: { cwd } } } as unknown as Agent
  return { agent } as unknown as ToolRunContext
}

const envDouble = {
  appStage: {
    devOriginURL: (dir: string, entry: string): string => `http://127.0.0.1:1/dev/${dir.split('/').pop()}/${entry}`,
    installedOriginURL: (appId: string, version: string, entry: string): string => `http://127.0.0.1:1/installed/${appId}/${version}/${entry}`,
  },
}

describe('app_list', () => {
  it('lists ready + rejected dev entries with machine reasons and originURL on ready', async () => {
    const home = await tempHome()
    const ws = await mkdtemp(join(tmpdir(), 'ws-'))
    const good = join(ws, '.deepcreator/apps/kanban')
    await mkdir(good, { recursive: true })
    await writeFile(join(good, 'app.json'), JSON.stringify(validManifest))
    await writeFile(join(good, 'index.html'), 'x')
    await writeFile(join(good, 'AGENT.md'), 'x')
    const bad = join(ws, '.deepcreator/apps/broken')
    await mkdir(bad, { recursive: true })
    await writeFile(join(bad, 'app.json'), '{ not json')

    const tool = createAppListTool({ ...envDouble, home })
    const result = await tool.execute({ scope: 'dev' }, execFor(ws)) as { dev: Array<Record<string, unknown>> }
    const ids = result.dev.map(entry => entry.appId)
    expect(ids).toEqual(['broken', 'kanban'])
    const kanban = result.dev.find(entry => entry.appId === 'kanban')!
    expect(kanban.status).toBe('ready')
    expect(kanban.version).toBe('0.2.0')
    expect(String(kanban.originURL)).toContain('/dev/')
    expect(kanban.conflictsWithInstalled).toBe(false)
    const broken = result.dev.find(entry => entry.appId === 'broken')!
    expect(broken.status).toBe('rejected')
    expect(broken.reason).toMatchObject({ code: 'manifest.invalid' })
    expect(broken.originURL).toBeUndefined()
  })

  it('lists installed entries with action summaries and source facts', async () => {
    const home = await tempHome()
    await installApp(home, validManifest)
    const tool = createAppListTool({ ...envDouble, home })
    const result = await tool.execute({ scope: 'installed' }, execFor('/ws/any')) as { installed: Array<Record<string, unknown>> }
    expect(result.installed).toHaveLength(1)
    const entry = result.installed[0]!
    expect(entry).toMatchObject({ appId: 'kanban', status: 'ready', version: '0.2.0', actionsSummary: ['createTask'], sourceWorkspace: '/ws/alpha' })
    expect(String(entry.originURL)).toContain('/installed/kanban/0.2.0/')
  })

  it('reports a no-workspace dev scope as an actionable envelope', async () => {
    const home = await tempHome()
    const tool = createAppListTool({ ...envDouble, home })
    const result = await tool.execute({ scope: 'dev' }, execFor(undefined)) as { error: { code: string } }
    expect(result.error.code).toBe('NO_WORKSPACE')
  })
})

describe('app_manifest', () => {
  it('returns the published manifest verbatim with the agent guide inline', async () => {
    const home = await tempHome()
    await installApp(home, validManifest)
    const tool = createAppManifestTool({ ...envDouble, home })
    const result = await tool.execute({ appId: 'kanban' }, execFor('/ws')) as Record<string, unknown>
    expect(result.appId).toBe('kanban')
    expect(result.version).toBe('0.2.0')
    expect(result.platform).toBe('app-stage-v1')
    expect((result.manifest as { actions: unknown[] }).actions).toHaveLength(1)
    expect(String(result.agentGuide)).toContain('createTask')
  })

  it('APP_NOT_INSTALLED and RUNTIME_BROKEN envelopes', async () => {
    const home = await tempHome()
    const tool = createAppManifestTool({ ...envDouble, home })
    const missing = await tool.execute({ appId: 'ghost' }, execFor('/ws')) as { error: { code: string; context: Record<string, string> } }
    expect(missing.error.code).toBe('APP_NOT_INSTALLED')
    expect(missing.error.context).toEqual({ appId: 'ghost' })
    // Broken: pointer present but snapshot dir emptied.
    await installApp(home, { ...validManifest, version: '0.3.0', agentGuide: undefined }, '')
    const { rm } = await import('node:fs/promises')
    await rm(join(home, 'deepcreator/apps/installed/kanban/0.3.0'), { recursive: true })
    const broken = await tool.execute({ appId: 'kanban' }, execFor('/ws')) as { error: { code: string } }
    expect(broken.error.code).toBe('RUNTIME_BROKEN')
  })
})
