import { describe, expect, it, vi } from 'vitest'
import {
  resolveSystemShell, systemShellCandidates, TerminalOutputBuffer,
} from '../src/native-terminal-model.ts'

describe('system terminal shell selection', () => {
  it('prefers PowerShell and retains cmd as the Windows fallback', () => {
    const candidates = systemShellCandidates('win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' })
    expect(candidates.map(candidate => candidate.command)).toEqual([
      'pwsh.exe', 'powershell.exe', 'C:\\Windows\\System32\\cmd.exe', 'cmd.exe',
    ])
  })

  it('prefers the user login shell on macOS and Linux', () => {
    expect(systemShellCandidates('darwin', { SHELL: '/opt/homebrew/bin/fish' })[0])
      .toMatchObject({ command: '/opt/homebrew/bin/fish', label: 'fish' })
    expect(systemShellCandidates('linux', { SHELL: '/usr/bin/zsh' })[0])
      .toMatchObject({ command: '/usr/bin/zsh', label: 'zsh' })
  })

  it('tries candidates in order until the Host execution world resolves one', async () => {
    const resolve = vi.fn(async (command: string) => {
      if (command === 'powershell.exe') return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      throw new Error('missing')
    })
    await expect(resolveSystemShell('win32', {}, resolve)).resolves.toMatchObject({ label: 'Windows PowerShell' })
    expect(resolve.mock.calls.map(call => call[0])).toEqual(['pwsh.exe', 'powershell.exe'])
  })
})

describe('TerminalOutputBuffer', () => {
  it('provides monotonic incremental raw reads', () => {
    const buffer = new TerminalOutputBuffer(20, 4)
    buffer.append('abc')
    expect(buffer.read(0)).toEqual({ data: 'abc', nextCursor: 3, truncated: false, hasMore: false })
    buffer.append('defgh')
    expect(buffer.read(3)).toEqual({ data: 'defg', nextCursor: 7, truncated: false, hasMore: true })
    expect(buffer.read(7)).toEqual({ data: 'h', nextCursor: 8, truncated: false, hasMore: false })
  })

  it('reports truncation and resumes from the retained tail', () => {
    const buffer = new TerminalOutputBuffer(5, 10)
    buffer.append('12345678')
    expect(buffer.read(0)).toEqual({ data: '45678', nextCursor: 8, truncated: true, hasMore: false })
  })
})
