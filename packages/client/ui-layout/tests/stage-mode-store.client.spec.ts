// @vitest-environment jsdom
/**
 * Stage-mode store-sharing account: the root entry and the sidebar
 * stage-mode entry both seat the SAME layout store handle, and the registry's
 * store instance axis (handle × scope key) must resolve both root-scope
 * registrations to ONE instance — otherwise the segmented control would flip
 * a private copy while AppFrame reads another, and the mode would never move.
 */
import { describe, expect, it, vi } from 'vitest'
import { SlotTestRuntime, stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { apply as themeApply, inject as themeInject } from '@ryanyujazz/dsh-client-ui-theme/client'
import { apply as sidebarApply, inject as sidebarInject } from '@ryanyujazz/dsh-client-ui-sidebar/client'
import { apply as layoutApply, inject as layoutInject } from '@ryanyujazz/dsh-client-ui-layout/client'

// jsdom lacks the observers AppFrame's effects construct at mount.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }))

describe('stage-mode store sharing', () => {
  it('resolves the root and stage-mode seats to one shared store instance', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    runtime.ctx.provide('remote', { $on: () => () => {} } as never)
    runtime.ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    await runtime.ctx.plugin({ inject: themeInject, apply: themeApply }).await()

    // ui-layout first: it provides ctx.layout which ui-sidebar's injects.
    // ui-sidebar's inject face also consumes the ui-workspace navigation
    // service (its New Session button); this spec's subject is store sharing,
    // so the navigation face is a stub at the service boundary.
    runtime.ctx.provide('uiWorkspace', { startSession: vi.fn() } as never)
    await runtime.mount({ inject: [...layoutInject], apply: layoutApply })
    await runtime.mount({ inject: [...sidebarInject], apply: sidebarApply })
    runtime.renderRoot()

    const rootStore = runtime.storeOf('root')
    const segStore = runtime.storeOf('sidebar.stage-mode')
    expect(rootStore).toBeTruthy()
    expect(segStore).toBeTruthy()
    expect(segStore).toBe(rootStore)
    // A write through the segmented entry's baked actions must be visible on
    // the root entry's snapshot — one truth, two seats.
    segStore.actions.setStageMode('apps')
    expect((rootStore.getSnapshot() as { stageMode: string }).stageMode).toBe('apps')
  })
})
