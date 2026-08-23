import type { Context } from '@deepseek-ai/cordis'
import { ChromeBridgeServer } from './bridge.ts'
import { ChromeExtensionProvider } from './provider.ts'

export * from './bridge.ts'
export * from './install.ts'
export * from './protocol.ts'
export * from './provider.ts'

export const name = 'browser-chrome-provider'
export const inject = ['browserRuntime']
export interface Config { enabled?: boolean }

export function apply(ctx: Context, config: Config = {}): void {
  const bridge = new ChromeBridgeServer()
  const desktopEnabled = config.enabled ?? process.env.DEEP_CREATOR_BROWSER_RPC_ENDPOINT !== undefined
  const provider = new ChromeExtensionProvider(bridge, desktopEnabled)
  ctx.effect(() => {
    const unregister = ctx.browserRuntime.registerBrowserProvider(provider)
    if (desktopEnabled) void bridge.start().catch(() => undefined)
    const offConnection = bridge.onConnection(() => ctx.browserRuntime.providerRuntime().providerChanged())
    const off = bridge.onNotification(event => {
      if (event.event === 'control-interrupted') { ctx.browserRuntime.providerRuntime().interruptByProviderTab('chrome', event.providerTabId); return }
      if (event.event === 'state-changed') { void ctx.browserRuntime.providerRuntime().refreshProviderTab('chrome', event.providerTabId).catch(() => undefined); return }
      void ctx.browserRuntime.providerRuntime().networkPolicy.assertAllowed(event.url).then(
        () => bridge.send({ kind: 'network-decision', decisionId: event.decisionId, allow: true }),
        error => bridge.send({ kind: 'network-decision', decisionId: event.decisionId, allow: false, message: error instanceof Error ? error.message : String(error) }),
      )
    })
    return () => { off(); offConnection(); unregister(); void bridge.dispose() }
  }, 'browser-chrome-provider: register')
}
