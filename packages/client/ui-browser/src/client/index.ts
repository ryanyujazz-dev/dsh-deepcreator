import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import { createElement, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@ryanyujazz/dsh-browser/remote'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import type {} from '@ryanyujazz/dsh-client-presentation/client'
import type { PresentationProvider } from '@ryanyujazz/dsh-client-presentation/client'
import { DeepCreatorIconPreview16 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelIconProps, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-settings/client'
import { BrowserPanel } from './BrowserPanel.tsx'
import { BrowserSettingsGroup } from './BrowserSettingsGroup.tsx'
import { en, NS, zh, type BrowserLocaleKey } from './locales.ts'
import { BrowserClientRuntime, type BrowserRemoteClient } from './runtime.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { browser: BrowserLocaleKey } }
export const inject = ['slots', 'workbench', 'locale', 'remote', 'remote.browser', 'sessions', 'presentation', 'settingsScope', 'connection']
type PanelComponent = (props: WorkbenchPanelProps & PropsLocale<'browser'>) => ReactNode

export function apply(ctx: ClientContext): void {
  // The Browser owns native surfaces, browser processes, and unrestricted
  // automation. A paired LAN browser receives the same Client bundle but this
  // feature contributes no seats on that surface.
  if (!(ctx.get('connection') as ConnectionHandle).isLoopback) return
  const remote = (ctx.get('remote') as TypertClientRemote)['browser'] as unknown as BrowserRemoteClient
  const browser = new BrowserClientRuntime(remote, () => ctx.sessions.list.getSnapshot().current)
  const browserSettings = ctx.settingsScope.bind<import('@ryanyujazz/dsh-browser').BrowserSettings>({
    namespace: 'browser',
    decode: value => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
      const candidate = value as Partial<import('@ryanyujazz/dsh-browser').BrowserSettings>
      if (!['semantic', 'playwright'].includes(candidate.defaultAutomation ?? '') || !['chromium', 'firefox', 'webkit'].includes(candidate.playwrightDefaultEngine ?? '') || !Array.isArray(candidate.visibleProviderOrder) || !candidate.visibleProviderOrder.every(item => typeof item === 'string')) return undefined
      return candidate as import('@ryanyujazz/dsh-browser').BrowserSettings
    },
  })
  const presenter: PresentationProvider = {
    id: 'workbench-browser', priority: 100, resourceKinds: ['browser-tab'],
    modes: window.deepcreatorBrowserSurface === undefined ? ['snapshot'] : ['live', 'snapshot'],
    surfaceHost: window.deepcreatorBrowserSurface !== undefined,
    async present(request, resource) {
      if (!ctx.workbench.types.list().some(type => type.id === 'browser')) return { status: 'unavailable', presenterId: 'workbench-browser', failure: { code: 'PANEL_UNAVAILABLE', stage: 'present', retryable: true, message: 'The Browser panel type is not registered in this client.' } }
      // Hydrate and verify the authoritative Browser identity before changing
      // the Workbench route. Routing first exposes a false "stale page" while
      // the matching full state snapshot is still in flight.
      await browser.refresh()
      const tab = browser.getSnapshot().state.tabs.find(candidate => candidate.tabId === resource.id)
      if (tab === undefined) return { status: 'unavailable', presenterId: 'workbench-browser', failure: { code: 'PANEL_UNAVAILABLE', stage: 'present', retryable: true, message: 'The Browser tab is absent from the client state snapshot.' } }
      if (tab.presentation === 'live' && window.deepcreatorBrowserSurface === undefined) return { status: 'unavailable', presenterId: 'workbench-browser', failure: { code: 'SURFACE_BRIDGE_UNAVAILABLE', stage: 'mount', retryable: false, message: 'This client has no native Browser surface bridge.' } }
      ctx.workbench.present({ typeId: 'browser', instanceId: resource.id, route: 'instance', reveal: true, reason: 'agent' })
      const remaining = Math.max(1, request.deadlineAt - Date.now() - 500)
      if (tab.presentation === 'live') {
        const mounted = await browser.waitForSurface(resource.id, Math.min(remaining, 5_000))
        if (!mounted.ok) return { status: 'unavailable', presenterId: 'workbench-browser', failure: { code: mounted.failure.code, stage: mounted.failure.code === 'PANEL_RENDER_TIMEOUT' ? 'present' : 'mount', retryable: false, message: mounted.failure.message } }
      }
      return { status: 'presented', presenterId: 'workbench-browser' }
    }, dismiss() {},
  }
  const createTab = async () => {
    const tab = await browser.newTab()
    try {
      const result = await ctx.presentation.open({ kind: 'browser-tab', tabId: tab.tabId })
      if (result.status !== 'presented') throw new Error(result.failure?.message ?? `Browser presentation ${result.status}.`)
    } catch (error) {
      // A user-created blank tab has no useful background lifetime when its
      // exact Surface cannot be shown. Roll it back instead of leaking it.
      await browser.closeTab(tab.tabId)
      throw error
    }
    return tab.tabId
  }
  const panel: PanelComponent = props => createElement(BrowserPanel, { ...props, browser, createTab })
  ctx.effect(() => {
    const disposers = [
      ctx.workbench.registerType({ id: 'browser', label: () => ctx.locale.bind(NS)('browser'), scope: 'session', order: 5, supportsHome: true, supportsCreate: false, supportsMultipleInstances: true, minWidth: 150, minHeight: 280, preferredWidth: 640, closePolicy: 'provider-controlled', disabledWhenAddressed: true }),
      ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({ name: 'deepcreator.workbench.panel', id: 'browser', locale: NS }, panel)),
      ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name: 'deepcreator.workbench.panel-icon', id: 'browser' }, ({ size }: WorkbenchPanelIconProps) => DeepCreatorIconPreview16({ size }))),
      ctx.slots.inject('settings.general.item', () => ctx.slots.register({ name: 'settings.general.item', id: 'browser-settings', order: 15, locale: NS, inject: () => ({ remote, browser, settings: browserSettings }) }, BrowserSettingsGroup)),
      ctx.locale.register(NS, { zh, en }), ctx.presentation.providers.register(presenter),
      ctx.workbench.dismissals.subscribe(() => {
        const dismissal = ctx.workbench.dismissals.getSnapshot()
        if (dismissal?.typeId !== 'browser') return
        ctx.presentation.dismiss('browser-tab', dismissal.instanceId)
        // Hiding the Browser group is presentation-only. Closing one of its
        // instance tabs is an explicit resource-destruction request.
        if (dismissal.instanceId !== undefined) void browser.closeTab(dismissal.instanceId)
      }),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose(); browser.dispose() }
  }, 'ui-browser: client runtime and workbench presenter')
}

export { BrowserClientRuntime } from './runtime.ts'
export type { BrowserSurfaceBridge } from './runtime.ts'
