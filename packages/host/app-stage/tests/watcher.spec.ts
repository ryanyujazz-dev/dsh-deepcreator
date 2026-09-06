import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppStageWatcherSet, WATCH_DEBOUNCE_MS } from '../src/watcher.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Minimal context double: records emits; logger is a no-op. */
function contextDouble(): { ctx: Context; emitted: string[] } {
  const emitted: string[] = []
  const ctx = {
    emit: (name: string, cwd: string) => { if (name === 'app-stage/dev-changed') emitted.push(cwd) },
    logger: { warn: () => {} },
  } as unknown as Context
  return { ctx, emitted }
}

async function tempWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'watch-ws-'))
}

const settle = async (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('session-bound watcher set (S4)', () => {
  it('binds once per workspace, refcounts, and unbinds with the last session', async () => {
    const { ctx, emitted } = contextDouble()
    const watchers = new AppStageWatcherSet(ctx)
    const ws = await tempWorkspace()
    watchers.bind(ws)
    watchers.bind(ws) // second session on the same workspace
    expect(watchers.activeRoots()).toEqual([join(ws, '.deepcreator', 'apps')])
    watchers.unbind(ws) // one session ends — watcher must survive
    expect(watchers.activeRoots()).toEqual([join(ws, '.deepcreator', 'apps')])
    watchers.dispose()
    expect(watchers.activeRoots()).toEqual([])
    expect(emitted).toEqual([])
  })

  it('emits app-stage/dev-changed on file activity under the apps root', async () => {
    const { ctx, emitted } = contextDouble()
    const watchers = new AppStageWatcherSet(ctx)
    const ws = await tempWorkspace()
    const appsRoot = join(ws, '.deepcreator', 'apps')
    await mkdir(join(appsRoot, 'kanban'), { recursive: true })
    watchers.bind(ws)
    await settle(50) // let the async start register the recursive watcher
    await writeFile(join(appsRoot, 'kanban', 'app.json'), '{}')
    await settle(WATCH_DEBOUNCE_MS + 250)
    watchers.dispose()
    expect(emitted.filter(root => root === appsRoot).length).toBeGreaterThanOrEqual(1)
  })

  it('the fallback path tolerates a missing apps root and reports it later', async () => {
    const { ctx, emitted } = contextDouble()
    const watchers = new AppStageWatcherSet(ctx)
    const ws = await tempWorkspace() // no .deepcreator/apps yet
    watchers.bind(ws)
    await settle(50)
    const appsRoot = join(ws, '.deepcreator', 'apps')
    await mkdir(join(appsRoot, 'late'), { recursive: true })
    await settle(2500)
    watchers.dispose()
    expect(emitted.filter(root => root === appsRoot).length).toBeGreaterThanOrEqual(1)
  })
})
