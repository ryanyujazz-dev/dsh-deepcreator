import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkbenchController } from '../src/client/service.ts'

const layout = {
  toggleSidebar: vi.fn(), closeDetails: vi.fn(),
  setWorkbenchWidth: vi.fn(), setWorkbenchFocused: vi.fn(),
}

const activity = {
  id: 'activity', label: () => 'Activity', scope: 'session' as const, supportsHome: true,
  supportsCreate: false, supportsMultipleInstances: false, minWidth: 280, minHeight: 220,
  closePolicy: 'dispose' as const,
}

describe('WorkbenchController', () => {
  it('registers types reversibly and rejects duplicate ownership', () => {
    const controller = new WorkbenchController(new Context(), layout)
    const dispose = controller.registerType(activity)
    expect(controller.types.list()).toEqual([activity])
    expect(() => controller.registerType(activity)).toThrow(/already registered/)
    dispose()
    expect(controller.types.list()).toEqual([])
  })

  it('publishes explicit presentation commands without mutating layout itself', () => {
    const controller = new WorkbenchController(new Context(), layout)
    controller.registerType(activity)
    controller.present({ typeId: 'activity', reason: 'agent' })
    expect(controller.commands.getSnapshot()?.action).toEqual({ kind: 'present', request: { typeId: 'activity', reason: 'agent' } })
    expect(layout.setWorkbenchWidth).not.toHaveBeenCalled()
  })

  it('publishes reveal as a user presentation carrying the focus target', () => {
    const controller = new WorkbenchController(new Context(), layout)
    controller.registerType(activity)
    controller.reveal('activity', 'src/app.ts')
    expect(controller.commands.getSnapshot()?.action).toEqual({
      kind: 'present',
      request: { typeId: 'activity', target: 'src/app.ts', reveal: true, reason: 'user' },
    })
    expect(() => controller.reveal('missing', 'x')).toThrow(/unknown panel type/)
  })

  it('shares mutable state with Cordis traced service views', () => {
    const controller = new WorkbenchController(new Context(), layout)
    const traced = Object.create(controller) as WorkbenchController
    const listener = vi.fn()
    controller.types.subscribe(listener)

    traced.registerType(activity)
    traced.present({ typeId: 'activity', reason: 'user', reveal: true })

    expect(controller.types.list()).toEqual([activity])
    expect(controller.types.version()).toBe(1)
    expect(controller.commands.getSnapshot()?.sequence).toBe(1)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('shares registrations made through an injected Cordis context', async () => {
    const ctx = new Context()
    const controller = new WorkbenchController(ctx, layout)

    await ctx.plugin({
      inject: ['workbench'],
      apply(scope: Context) { scope.workbench.registerType(activity) },
    }).await()

    expect(controller.types.list()).toEqual([activity])
    expect(controller.types.version()).toBe(1)
  })

  it('publishes the Details-owned visibility projection to Header consumers', () => {
    const controller = new WorkbenchController(new Context(), layout)
    const listener = vi.fn()
    controller.visibility.subscribe(listener)

    controller.setVisibleTypes(['activity', 'artifact'])
    controller.setVisibleTypes(['activity', 'artifact'])

    expect(controller.visibility.list()).toEqual(['activity', 'artifact'])
    expect(controller.visibility.version()).toBe(1)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('publishes explicit user dismissal edges separately from visibility', () => {
    const controller = new WorkbenchController(new Context(), layout)
    const listener = vi.fn()
    controller.dismissals.subscribe(listener)

    controller.hide('browser')
    expect(controller.dismissals.getSnapshot()).toMatchObject({ typeId: 'browser' })
    controller.closeTab('browser', 'tab-1')
    expect(controller.dismissals.getSnapshot()).toMatchObject({ typeId: 'browser', instanceId: 'tab-1' })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(controller.visibility.list()).toEqual([])
  })
})
