/** Pure selection and buffering helpers for the local interactive terminal. */

export interface SystemShell {
  path: string
  args: readonly string[]
  label: string
}

interface ShellCandidate {
  command: string
  args: readonly string[]
  label: string
}

function uniqueCandidates(candidates: readonly ShellCandidate[]): ShellCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = candidate.command.toLowerCase()
    if (candidate.command.length === 0 || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Ordered system-shell candidates for one Host platform. */
export function systemShellCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly ShellCandidate[] {
  if (platform === 'win32') {
    return uniqueCandidates([
      { command: 'pwsh.exe', args: [], label: 'PowerShell' },
      { command: 'powershell.exe', args: [], label: 'Windows PowerShell' },
      ...(env.ComSpec === undefined ? [] : [{ command: env.ComSpec, args: [], label: 'Command Prompt' }]),
      { command: 'cmd.exe', args: [], label: 'Command Prompt' },
    ])
  }

  const fallback = platform === 'darwin'
    ? [
        { command: '/bin/zsh', args: ['-l'], label: 'zsh' },
        { command: '/bin/bash', args: ['-l'], label: 'bash' },
        { command: '/bin/sh', args: ['-l'], label: 'sh' },
      ]
    : [
        { command: '/bin/bash', args: ['-l'], label: 'bash' },
        { command: '/bin/zsh', args: ['-l'], label: 'zsh' },
        { command: '/bin/sh', args: ['-l'], label: 'sh' },
      ]
  const loginShell = env.SHELL === undefined
    ? []
    : [{ command: env.SHELL, args: ['-l'], label: env.SHELL.split('/').at(-1) || env.SHELL }]
  return uniqueCandidates([...loginShell, ...fallback])
}

/** Resolve the first shell executable that exists in the Host execution world. */
export async function resolveSystemShell(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  resolveExecutable: (command: string) => Promise<string>,
): Promise<SystemShell> {
  const failures: string[] = []
  for (const candidate of systemShellCandidates(platform, env)) {
    try {
      return {
        path: await resolveExecutable(candidate.command),
        args: candidate.args,
        label: candidate.label,
      }
    } catch {
      failures.push(candidate.command)
    }
  }
  throw new Error(`terminal-workbench: no system shell found (${failures.join(', ')})`)
}

export interface RawTerminalRead {
  data: string
  nextCursor: number
  truncated: boolean
  hasMore: boolean
}

/** Monotonic, bounded raw ANSI stream used by independent browser readers. */
export class TerminalOutputBuffer {
  private value = ''
  private baseCursor = 0
  private endCursor = 0

  constructor(
    private readonly maxCharacters = 2 * 1024 * 1024,
    private readonly maxReadCharacters = 256 * 1024,
  ) {}

  append(data: string): void {
    if (data.length === 0) return
    this.value += data
    this.endCursor += data.length
    if (this.value.length <= this.maxCharacters) return
    const dropped = this.value.length - this.maxCharacters
    this.value = this.value.slice(dropped)
    this.baseCursor += dropped
  }

  read(cursor = 0): RawTerminalRead {
    const cursorInvalid = cursor < this.baseCursor || cursor > this.endCursor
    const begin = cursorInvalid ? this.baseCursor : cursor
    const available = this.endCursor - begin
    const count = Math.min(available, this.maxReadCharacters)
    const offset = begin - this.baseCursor
    return {
      data: this.value.slice(offset, offset + count),
      nextCursor: begin + count,
      truncated: cursorInvalid,
      hasMore: count < available,
    }
  }

  snapshot(): string { return this.value }
}
