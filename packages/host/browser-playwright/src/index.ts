import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-user-approval'
import { isBrowserToolOwner } from '@ryanyujazz/dsh-browser'
import type { PlaywrightEngine } from './managed-provider.ts'
import { ManagedPlaywrightProvider, PlaywrightOwnerClient } from './owner-client.ts'
import { createPlaywrightRunTool } from './tool.ts'

export * from './managed-provider.ts'
export * from './owner-client.ts'
export * from './owner-protocol.ts'
export * from './script-isolate.ts'
export * from './tool.ts'

export const name = 'browser-playwright-provider'
export const inject = ['agents', 'tools', 'approval', 'browserRuntime', 'subprocess']
export interface Config { engines?: PlaywrightEngine[] }

export function apply(ctx: Context, config: Config = {}): void {
  const runtime = ctx.browserRuntime.providerRuntime()
  const owner = new PlaywrightOwnerClient(); owner.start(ctx.subprocess)
  const providers = (config.engines ?? ['chromium', 'firefox', 'webkit']).map(engine => new ManagedPlaywrightProvider(engine, owner))
  ctx.effect(() => {
    const unregister = providers.map(provider => ctx.browserRuntime.registerBrowserProvider(provider))
    return () => { for (const dispose of unregister.reverse()) dispose(); void owner.dispose() }
  }, 'browser-playwright-provider: register')
  ctx.on('agent/session-start', ({ agent }: { agent: Agent }) => {
    if (!isBrowserToolOwner(ctx.agents, agent)) return
    agent.ctx.effect(() => agent.ctx.tools.register(createPlaywrightRunTool({ runtime, approval: ctx.approval, turnOf: candidate => ctx.browserRuntime.currentTurn(candidate) })), 'browser-playwright-provider: root-agent tool')
  })
}
