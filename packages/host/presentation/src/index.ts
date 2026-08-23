import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { PresentationRuntime } from './runtime.ts'
import { createOpenInDeepCreatorTool } from './tool.ts'
import type {
  OpenInDeepCreatorResult,
  PresentationClaimResult, PresentationClientDescriptor, PresentationPendingSnapshot, PresentationReceipt,
  PresentationRemoteResult, PresentationResourceResolver,
} from './types.ts'
import { presentationSignal } from './types.ts'

export * from './runtime.ts'
export * from './tool.ts'
export * from './types.ts'

export const name = 'presentation-runtime'
export const inject = ['agents', 'tools']
export function isPresentationToolOwner(agents: { roots(): readonly Agent[] }, agent: Agent): boolean { return agents.roots().includes(agent) }

declare module '@deepseek-ai/cordis' { interface Context { presentationRuntime: PresentationHostService } }

export class PresentationHostService extends TypertRemoteService {
  static inject = inject
  // Cordis exposes services through a Proxy. Native `#private` fields reject a
  // Proxy receiver, so service methods must use ordinary instance properties.
  private readonly runtime: PresentationRuntime = new PresentationRuntime()
  private readonly turns = new Map<string, number>()
  private userOpenSequence = 0

  constructor(ctx: Context) {
    super(ctx, 'presentationRuntime', { namespace: 'presentation' })
    ctx.on('agent/session-start', ({ agent }: { agent: Agent }) => {
      if (!isPresentationToolOwner(ctx.agents, agent)) return
      agent.ctx.effect(() => agent.ctx.tools.register(createOpenInDeepCreatorTool({ runtime: this.runtime, turnOf: candidate => this.turnOf(candidate) })), 'presentation-runtime: root-agent tool')
    })
    ctx.on('agent/pre-step', async ({ agent, turn }: { agent: Agent; turn: number }, next: () => Promise<PreStepDecision>) => {
      this.turns.set(String(agent.id), turn)
      return next()
    })
    ctx.on('agent/turn-stopping', ({ agent, turn }: { agent: Agent; turn: number }) => {
      this.runtime.endTurn(String(agent.id), turn)
      this.turns.delete(String(agent.id))
    })
    ctx.on('agent/disposed', ({ agent }: { agent: Agent }) => {
      const sessionId = String(agent.id)
      const turn = this.turns.get(sessionId)
      if (turn !== undefined) this.runtime.endTurn(sessionId, turn)
      this.turns.delete(sessionId)
    })
    ctx.effect(() => () => this.runtime.dispose(), 'presentation-runtime: dispose')
  }

  registerResolver<I extends { kind: string }>(resolver: PresentationResourceResolver<I>): () => void { return this.runtime.registerResolver(resolver) }

  @Remote('pending')
  pending(agent: Agent, client: PresentationClientDescriptor): PresentationRemoteResult<PresentationPendingSnapshot> {
    return { ok: true, value: this.runtime.pending(String(agent.id), client) }
  }

  @Remote('waitRevision')
  async waitRevision(agent: Agent, afterRevision: number): Promise<PresentationRemoteResult<{ revision: number }>> {
    return { ok: true, value: { revision: await this.runtime.waitForRevision(String(agent.id), afterRevision, AbortSignal.timeout(25_000)) } }
  }

  @Remote('claim')
  claim(agent: Agent, requestId: string, client: PresentationClientDescriptor): PresentationRemoteResult<PresentationClaimResult> {
    return { ok: true, value: this.runtime.claim(String(agent.id), requestId, client) }
  }

  @Remote('acknowledge')
  acknowledge(agent: Agent, receipt: PresentationReceipt): PresentationRemoteResult<{ acknowledged: boolean }> {
    return { ok: true, value: { acknowledged: this.runtime.acknowledge(String(agent.id), receipt) } }
  }

  @Remote('dismiss')
  dismiss(agent: Agent, turn: number, resourceKey: string): PresentationRemoteResult<{ dismissed: true }> {
    this.runtime.dismiss(String(agent.id), turn, resourceKey)
    if (turn < 0) this.runtime.endTurn(String(agent.id), turn)
    return { ok: true, value: { dismissed: true } }
  }

  /**
   * User-initiated counterpart to the Agent tool. It uses the same resolvers,
   * client claim and receipt protocol, but a synthetic turn keeps explicit UI
   * actions available even while the Agent is idle.
   */
  @Remote('open')
  async open(agent: Agent, inputJson: string): Promise<PresentationRemoteResult<OpenInDeepCreatorResult>> {
    const sessionId = String(agent.id)
    const turn = -(++this.userOpenSequence)
    try {
      if (inputJson.length > 65_536) throw new Error('Presentation input exceeds the 64 KiB client boundary.')
      const parsed = this.runtime.parse(JSON.parse(inputJson))
      const value = await this.runtime.open({
        sessionId, turn,
        workspaceRoot: agent.session.header.cwd ?? process.cwd(),
        signal: presentationSignal({ aborted: false }),
      }, parsed)
      if (value.status !== 'presented') this.runtime.endTurn(sessionId, turn)
      return { ok: true, value }
    } catch (error) {
      this.runtime.endTurn(sessionId, turn)
      return { ok: false, code: 'PRESENTATION_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) }
    }
  }

  private turnOf(agent: Agent): number {
    const turn = this.turns.get(String(agent.id))
    if (turn === undefined) throw new Error('open_in_deepcreator requires an open Agent turn.')
    return turn
  }
}

export default PresentationHostService
