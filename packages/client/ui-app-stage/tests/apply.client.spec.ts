/** Seat registration semantics: waits for the frame's declaration, injects
 * its faces once, and unloads reversibly with the plugin fiber. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { apply, inject } from '@ryanyujazz/dsh-client-ui-app-stage/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('layout', { setDockOpen: vi.fn(), setStageMode: vi.fn() } as never)
  ctx.provide('sessions', { list: { subscribe: () => () => {}, getSnapshot: () => ({ current: 's1' }) } } as never)
  const appStage = { list: vi.fn(), ensure: vi.fn() }
  const remoteFace = new Proxy({}, { get: (_target, key: string) => (key === 'appStage' ? appStage : undefined) })
  ctx.provide('remote', remoteFace as never)
  // The namespaced service key the inject array waits on (workbench-remotes
  // mounts it in production); without it cordis leaves the plugin dormant.
  ctx.provide('remote.appStage', appStage as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    slots.register(
      {
        name: 'root',
        children: { 'deepcreator.stage.apps': { kind: 'single', scope: 'root' } },
      } as never,
      () => null,
    )
  }
  return { ctx, slots, layout: ctx.get('layout') as { setDockOpen: ReturnType<typeof vi.fn> }, appStage }
}

describe('ui-app-stage apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'layout', 'sessions', 'remote', 'remote.appStage'])
  })

  it('occupies the declared seat with its injected faces', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(b.slots.entries('deepcreator.stage.apps')).toHaveLength(1)
    const entry = b.slots.entries('deepcreator.stage.apps')[0]!
    expect(entry.locale).toBe('app-stage')
    const injected = entry.inject as () => {
      layout: { setDockOpen(open: boolean): void }
      remote: unknown
      sessions: { subscribe(): () => void; getSnapshot(): unknown }
      scanTick: number
    }
    const faces = injected()
    expect(Object.keys(faces)).toEqual(['layout', 'remote', 'sessions', 'scanTick', 'router'])
    expect(faces.remote).toBe(b.appStage)
    expect(faces.sessions.getSnapshot()).toBe('s1')
    expect(faces.router).toBeDefined()
    faces.layout.setDockOpen(true)
    expect(b.layout.setDockOpen).toHaveBeenCalledWith(true)
  })

  it('stays a pending wait (never an error) without the declaration — S3', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(b.slots.entries('deepcreator.stage.apps')).toHaveLength(0)
  })

  it('vacates the seat on plugin teardown', async () => {
    const b = await bench()
    const plugin = b.ctx.plugin({ inject: [...inject], apply })
    await plugin.await()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(b.slots.entries('deepcreator.stage.apps')).toHaveLength(1)
    await plugin.dispose()
    expect(b.slots.entries('deepcreator.stage.apps')).toHaveLength(0)
  })
})
