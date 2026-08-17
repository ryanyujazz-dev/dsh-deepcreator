import { realpath } from 'node:fs/promises'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { scrubbedParentEnv, type SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  TerminalBackend, TerminalBackendSession, TerminalBackendSpawnSpec, TerminalReadRequest,
  TerminalReadResult, TerminalSendOperation, TerminalSendRequest, TerminalSessionStatus,
  TerminalSignal, TerminalSignalResult,
} from '@deepseek-ai/dsh-terminal'
import { spawn as spawnPty, type IDisposable, type IPty } from 'node-pty'
import { resolveSystemShell, TerminalOutputBuffer, type RawTerminalRead, type SystemShell } from './native-terminal-model.ts'

export const SYSTEM_TERMINAL_BACKEND = 'system'
const INITIAL_COLS = 120
const INITIAL_ROWS = 30
const CLOSE_GRACE_MS = 3_000

export interface SystemTerminalMetadata {
  shell: string
  cwd: string
  platform: NodeJS.Platform
}

function terminalStatus(exited: boolean, exitCode: number | null): TerminalSessionStatus {
  return exited
    ? { kind: 'exited', exitCode, signal: null }
    : { kind: 'running' }
}

function positiveDimension(value: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('terminal-workbench: terminal dimensions must be finite')
  return Math.max(1, Math.min(maximum, Math.floor(value)))
}

class SystemTerminalSession implements TerminalBackendSession {
  readonly motd = ''
  readonly pid: number
  readonly output = new TerminalOutputBuffer()
  private readonly dataDisposable: IDisposable
  private readonly exitDisposable: IDisposable
  private readonly exitedPromise: Promise<void>
  private resolveExited: (() => void) | undefined
  private exited = false
  private exitCode: number | null = null
  private closing: Promise<void> | undefined

  constructor(
    readonly owner: Agent,
    readonly metadata: SystemTerminalMetadata,
    private readonly pty: IPty,
    private readonly onClosed: () => void,
  ) {
    this.pid = pty.pid
    this.exitedPromise = new Promise<void>((resolve) => { this.resolveExited = resolve })
    this.dataDisposable = pty.onData(data => { this.output.append(data) })
    this.exitDisposable = pty.onExit(({ exitCode }) => {
      if (this.exited) return
      this.exited = true
      this.exitCode = exitCode
      this.dataDisposable.dispose()
      this.exitDisposable.dispose()
      this.resolveExited?.()
      this.resolveExited = undefined
    })
  }

  rawRead(cursor?: number): RawTerminalRead { return this.output.read(cursor) }

  rawWrite(data: string): void {
    if (this.exited) throw new Error('terminal-workbench: terminal process has exited')
    if (data.length > 64 * 1024) throw new Error('terminal-workbench: one input frame may not exceed 64 KiB')
    this.pty.write(data)
  }

  resize(cols: number, rows: number): { cols: number; rows: number } {
    if (this.exited) throw new Error('terminal-workbench: terminal process has exited')
    const resolvedCols = positiveDimension(cols, 500)
    const resolvedRows = positiveDimension(rows, 200)
    this.pty.resize(resolvedCols, resolvedRows)
    return { cols: resolvedCols, rows: resolvedRows }
  }

  startSend(request: TerminalSendRequest): TerminalSendOperation {
    let settled = false
    const done = Promise.resolve().then(() => {
      request.signal?.throwIfAborted()
      this.rawWrite(request.text + (request.submit ? '\r' : ''))
      settled = true
      return {
        viewport: '',
        waitReason: 'inferred_idle' as const,
        sessionStatus: this.status(),
        truncated: false,
      }
    })
    return {
      done,
      readOutput: () => ({ delta: '', truncated: false }),
      cancel: () => {
        if (settled) return false
        this.rawWrite('\u0003')
        return true
      },
    }
  }

  read(request: TerminalReadRequest): TerminalReadResult {
    const lines = this.output.snapshot().split('\n')
    const totalLines = lines.length
    const offset = Math.max(0, Math.floor(request.offset ?? 0))
    const count = Math.max(1, Math.min(2_000, Math.floor(request.count ?? 200)))
    const end = Math.max(0, totalLines - offset)
    const begin = Math.max(0, end - count)
    return {
      text: lines.slice(begin, end).join('\n'),
      totalLines,
      lineBegin: totalLines - end,
      lineEnd: totalLines - begin,
      truncated: false,
    }
  }

  async signal(signal: TerminalSignal): Promise<TerminalSignalResult> {
    if (signal === 'SIGINT') this.rawWrite('\u0003')
    else if (signal === 'SIGTSTP') this.rawWrite('\u001a')
    else if (process.platform === 'win32') this.pty.kill()
    else this.pty.kill(signal)
    return { delivered: true, targetPgid: this.pid }
  }

  status(): TerminalSessionStatus { return terminalStatus(this.exited, this.exitCode) }

  close(_reason: string): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closing = this.closeOnce()
    return this.closing
  }

  private async closeOnce(): Promise<void> {
    if (this.exited) {
      this.onClosed()
      return
    }
    try { this.pty.kill() } catch { /* The process may have exited between status and kill. */ }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.exitedPromise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new Error('terminal-workbench: terminal did not exit after kill')) }, CLOSE_GRACE_MS)
        }),
      ])
      this.onClosed()
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/** Interactive system-shell backend registered into the official owner-scoped terminal service. */
export class SystemTerminalBackend implements TerminalBackend {
  readonly type = SYSTEM_TERMINAL_BACKEND
  private readonly sessions = new Map<string, SystemTerminalSession>()
  private shell: Promise<SystemShell> | undefined

  constructor(
    private readonly subprocess: SubprocessRuntime,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private resolveShell(): Promise<SystemShell> {
    this.shell ??= resolveSystemShell(
      this.platform,
      this.env,
      command => this.subprocess.resolveExecutable(command),
    )
    return this.shell
  }

  async spawn(spec: TerminalBackendSpawnSpec): Promise<TerminalBackendSession> {
    spec.signal?.throwIfAborted()
    const shell = await this.resolveShell()
    const cwd = await realpath(spec.cwd ?? spec.owner.session.header.cwd ?? process.cwd())
    spec.signal?.throwIfAborted()
    const childEnv = {
      ...scrubbedParentEnv(),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'DeepCreator',
    }
    const pty = spawnPty(shell.path, [...shell.args], {
      name: 'xterm-256color',
      cols: INITIAL_COLS,
      rows: INITIAL_ROWS,
      cwd,
      env: childEnv,
      ...(this.platform === 'win32' ? { useConpty: true } : {}),
    })
    const id = String(spec.sessionId)
    const session = new SystemTerminalSession(
      spec.owner,
      { shell: shell.label, cwd, platform: this.platform },
      pty,
      () => { this.sessions.delete(id) },
    )
    this.sessions.set(id, session)
    return session
  }

  owned(owner: Agent, sessionId: string): SystemTerminalSession {
    const session = this.sessions.get(sessionId)
    if (session === undefined) throw new Error(`terminal-workbench: interactive terminal ${sessionId} is missing`)
    if (session.owner !== owner) throw new Error(`terminal-workbench: interactive terminal ${sessionId} belongs to another Agent`)
    return session
  }

  metadata(sessionId: string): SystemTerminalMetadata | undefined {
    return this.sessions.get(sessionId)?.metadata
  }

  async dispose(): Promise<void> {
    const sessions = [...this.sessions.values()]
    await Promise.allSettled(sessions.map(session => session.close('terminal backend disposed')))
  }
}
