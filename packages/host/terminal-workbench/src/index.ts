import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  TerminalError, TerminalSessionId,
  type TerminalSessionSnapshot, type TerminalSessionStatus, type TerminalSpawnResult,
} from '@deepseek-ai/dsh-terminal'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TerminalBackendsResult, TerminalKillRemoteResult, TerminalListResult, TerminalReadRemoteResult,
  TerminalInputRemoteResult, TerminalRawReadRemoteResult, TerminalReadRequest, TerminalResizeRemoteResult,
  TerminalSendRemoteResult, TerminalSignalName, TerminalSignalRemoteResult,
  TerminalSpawnRemoteResult, TerminalSpawnRequest, TerminalSpawnView, TerminalStatus,
  TerminalWorkbenchFailure,
} from './types.ts'
import { SYSTEM_TERMINAL_BACKEND, SystemTerminalBackend } from './native-terminal.ts'

export type {
  TerminalBackendsResult, TerminalKillRemoteResult, TerminalListResult, TerminalReadPage,
  TerminalInputRemoteResult, TerminalRawReadPage, TerminalRawReadRemoteResult, TerminalReadRemoteResult,
  TerminalReadRequest, TerminalResizeRemoteResult, TerminalResizeView, TerminalSendRemoteResult, TerminalSendView,
  TerminalSessionView, TerminalSignalName, TerminalSignalRemoteResult, TerminalSignalView,
  TerminalSpawnRemoteResult, TerminalSpawnRequest, TerminalSpawnView, TerminalStatus,
  TerminalWaitReason, TerminalWorkbenchErrorCode, TerminalWorkbenchFailure,
} from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { terminalWorkbench: TerminalWorkbenchService } }

function failure(error: unknown): TerminalWorkbenchFailure {
  return {
    ok: false,
    code: error instanceof TerminalError ? error.code : 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  }
}

function statusView(status: TerminalSessionStatus): TerminalStatus {
  return status.kind === 'running'
    ? { kind: 'running' }
    : { kind: 'exited', exitCode: status.exitCode, signal: status.signal }
}

function sessionView(session: TerminalSessionSnapshot): TerminalSpawnView | Omit<TerminalSpawnView, 'motd'> {
  return {
    sessionId: session.sessionId,
    type: session.type,
    status: statusView(session.status),
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(session.pid === undefined ? {} : { pid: session.pid }),
    ...('motd' in session ? { motd: (session as TerminalSpawnResult).motd } : {}),
  }
}

/** Agent-authorized Workbench facade over `ctx.terminals`. */
export class TerminalWorkbenchService extends TypertRemoteService {
  static inject = ['terminals', 'subprocess']
  private readonly system: SystemTerminalBackend

  constructor(ctx: Context) {
    super(ctx, 'terminalWorkbench', { namespace: 'terminal-workbench' })
    this.system = new SystemTerminalBackend(ctx.subprocess)
    ctx.effect(() => {
      const unregister = ctx.terminals.registerBackend(this.system)
      return async () => {
        unregister()
        await this.system.dispose()
      }
    }, 'terminal-workbench: system terminal backend')
  }

  private view(session: TerminalSessionSnapshot): TerminalSpawnView | Omit<TerminalSpawnView, 'motd'> {
    const base = sessionView(session)
    const metadata = session.type === SYSTEM_TERMINAL_BACKEND
      ? this.system.metadata(String(session.sessionId))
      : undefined
    return metadata === undefined
      ? base
      : { ...base, interactive: true, shell: metadata.shell, cwd: metadata.cwd, platform: metadata.platform }
  }

  @Remote('backends')
  backends(agent: Agent): TerminalBackendsResult {
    void agent
    try {
      const backends = this.ctx.terminals.listBackends()
      return { ok: true, backends: [SYSTEM_TERMINAL_BACKEND, ...backends.filter(type => type !== SYSTEM_TERMINAL_BACKEND)] }
    }
    catch (error) { return failure(error) }
  }

  @Remote('list')
  list(agent: Agent): TerminalListResult {
    try { return { ok: true, sessions: this.ctx.terminals.list(agent).map(session => this.view(session)) } }
    catch (error) { return failure(error) }
  }

  @Remote('spawn')
  async spawn(agent: Agent, request: TerminalSpawnRequest): Promise<TerminalSpawnRemoteResult> {
    try {
      const cwd = agent.session.header.cwd
      const session = await this.ctx.terminals.spawn(agent, {
        ...request,
        ...(request.type === SYSTEM_TERMINAL_BACKEND && cwd !== undefined ? { cwd } : {}),
      })
      return { ok: true, session: this.view(session) as TerminalSpawnView }
    }
    catch (error) { return failure(error) }
  }

  @Remote('read')
  read(agent: Agent, sessionId: string, request?: TerminalReadRequest): TerminalReadRemoteResult {
    try { return { ok: true, page: this.ctx.terminals.read(agent, TerminalSessionId(sessionId), request) } }
    catch (error) { return failure(error) }
  }

  @Remote('readRaw')
  readRaw(agent: Agent, sessionId: string, cursor?: number): TerminalRawReadRemoteResult {
    try {
      const session = this.system.owned(agent, sessionId)
      return { ok: true, page: { ...session.rawRead(cursor), status: statusView(session.status()) } }
    } catch (error) { return failure(error) }
  }

  @Remote('input')
  input(agent: Agent, sessionId: string, data: string): TerminalInputRemoteResult {
    try {
      this.system.owned(agent, sessionId).rawWrite(data)
      return { ok: true, accepted: true }
    } catch (error) { return failure(error) }
  }

  @Remote('resize')
  resize(agent: Agent, sessionId: string, cols: number, rows: number): TerminalResizeRemoteResult {
    try { return { ok: true, size: this.system.owned(agent, sessionId).resize(cols, rows) } }
    catch (error) { return failure(error) }
  }

  @Remote('send')
  async send(agent: Agent, sessionId: string, text: string, submit: boolean): Promise<TerminalSendRemoteResult> {
    try {
      const operation = this.ctx.terminals.startSend(agent, TerminalSessionId(sessionId), { text, submit })
      const result = await operation.done
      return { ok: true, result: { ...result, sessionStatus: statusView(result.sessionStatus) } }
    } catch (error) { return failure(error) }
  }

  @Remote('signal')
  async signal(agent: Agent, sessionId: string, terminalSignal: TerminalSignalName): Promise<TerminalSignalRemoteResult> {
    try { return { ok: true, result: await this.ctx.terminals.signal(agent, TerminalSessionId(sessionId), terminalSignal) } }
    catch (error) { return failure(error) }
  }

  @Remote('kill')
  async kill(agent: Agent, sessionId: string): Promise<TerminalKillRemoteResult> {
    try { return { ok: true, closed: await this.ctx.terminals.kill(agent, TerminalSessionId(sessionId), 'workbench tab closed') } }
    catch (error) { return failure(error) }
  }
}

export default TerminalWorkbenchService
