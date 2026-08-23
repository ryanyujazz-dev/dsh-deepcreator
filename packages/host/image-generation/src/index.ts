import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-attachment'
import { createImageTool } from './tool.ts'
import { IMAGE_GENERATION_SETTINGS_KEY, ImageGenerationSettingsSchema } from './settings.ts'
import { ImageGenerationRetryPolicy } from './retry-policy.ts'
import { ImageGenerationRuntime } from './runtime.ts'

declare module '@deepseek-ai/cordis' { interface Context { imageGenerationRuntime: ImageGenerationRuntime } }

export * from './settings.ts'
export * from './retry-policy.ts'
export * from './types.ts'
export * from './runtime.ts'
export { generateImage } from './providers.ts'

export const name = 'image-generation'
export const inject = ['agents', 'tools', 'settings', 'credentials', 'attachments']

export default class ImageGenerationPlugin {
  static inject = inject
  private readonly retryPolicy = new ImageGenerationRetryPolicy()
  private readonly turns = new Map<string, number>()

  constructor(ctx: Context) {
    const runtime = new ImageGenerationRuntime(ctx)
    ctx.settings.register(IMAGE_GENERATION_SETTINGS_KEY, ImageGenerationSettingsSchema)
    ctx.on('agent/session-start', ({ agent }: { agent: Agent }) => {
      if (!ctx.agents.roots().includes(agent)) return
      agent.ctx.effect(() => agent.ctx.tools.register(createImageTool(ctx, {
        runtime,
        retryPolicy: this.retryPolicy,
        turnOf: candidate => this.turnOf(candidate),
      })), 'image-generation: create_image')
    })
    ctx.on('agent/pre-step', async ({ agent, turn }: { agent: Agent; turn: number }, next: () => Promise<PreStepDecision>) => {
      this.turns.set(String(agent.id), turn)
      return next()
    })
    ctx.on('agent/turn-stopping', ({ agent, turn }: { agent: Agent; turn: number }) => {
      const sessionId = String(agent.id)
      this.retryPolicy.endTurn({ sessionId, turn })
      this.turns.delete(sessionId)
    })
    ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
      const sessionId = String(agent.id)
      this.retryPolicy.endSession(sessionId)
      this.turns.delete(sessionId)
    })
    ctx.effect(() => () => this.retryPolicy.dispose(), 'image-generation: retry policy dispose')
  }

  private turnOf(agent: Agent): number {
    const turn = this.turns.get(String(agent.id))
    if (turn === undefined) throw new Error('create_image requires an open Agent turn.')
    return turn
  }
}
