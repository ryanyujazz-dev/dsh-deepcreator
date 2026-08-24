// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/TerminalEmulator.tsx', () => ({ TerminalEmulator: () => null }))

import { TerminalPanel } from '../src/client/Panels.tsx'

afterEach(cleanup)

const runningSession = {
  sessionId: 'terminal-existing',
  type: 'system',
  status: { kind: 'running' as const },
  interactive: true,
}

function props(terminal: Record<string, ReturnType<typeof vi.fn>>, openInstance = vi.fn()): ComponentProps<typeof TerminalPanel> {
  return {
    terminal,
    useSessions: selector => selector({ currentAddress: undefined } as never),
    sessionId: 'session-1',
    route: 'home',
    tabs: [],
    typeId: 'terminal',
    openInstance,
    closeInstance: vi.fn(),
    showHome: vi.fn(),
    contributeHeaderActions: () => () => undefined,
    contributePanelInfo: () => () => undefined,
    renderArtifact: () => null,
    t: (key: string) => key,
  } as ComponentProps<typeof TerminalPanel>
}

describe('Terminal Panel initialization', () => {
  it('spawns and opens the first terminal tab automatically', async () => {
    const terminal = {
      // A delayed list models the real remote round-trip so the optimistic
      // spawn merge commits before the authoritative refresh replaces it.
      list: vi.fn().mockImplementation(() => new Promise(resolve => {
        setTimeout(() => resolve({ ok: true, value: { ok: true, sessions: [] } }), 10)
      })),
      backends: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, backends: ['system'] } }),
      spawn: vi.fn().mockResolvedValue({
        ok: true,
        value: { ok: true, session: {
          ...runningSession,
          sessionId: 'terminal-new',
          shell: 'PowerShell',
          cwd: 'D:\\work\\myapp',
          motd: '',
        } },
      }),
      kill: vi.fn(), input: vi.fn(), signal: vi.fn(),
    }
    const openInstance = vi.fn()
    const contributePanelInfo = vi.fn(() => () => undefined)
    render(<TerminalPanel {...props(terminal, openInstance)} contributePanelInfo={contributePanelInfo} />)

    // Unnamed spawn: the official service enforces per-owner name
    // uniqueness, so a fixed name would break every later terminal.
    await waitFor(() => { expect(terminal.spawn).toHaveBeenCalledWith('session-1', { type: 'system' }) })
    await waitFor(() => { expect(openInstance).toHaveBeenCalledWith('terminal-new') })
    expect(terminal.spawn).toHaveBeenCalledOnce()
    // The spawn view merges optimistically, so the pill is labeled by its
    // project folder without waiting for the list round-trip.
    await waitFor(() => { expect(contributePanelInfo).toHaveBeenCalledWith({ tabLabels: { 'terminal-new': 'myapp' }, titleSuffix: 'PowerShell' }) })
  })

  it('restores a running terminal instead of spawning a duplicate', async () => {
    const terminal = {
      list: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, sessions: [runningSession] } }),
      backends: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, backends: ['system'] } }),
      spawn: vi.fn(), kill: vi.fn(), input: vi.fn(), signal: vi.fn(),
    }
    const openInstance = vi.fn()
    render(<TerminalPanel {...props(terminal, openInstance)} />)

    await waitFor(() => { expect(openInstance).toHaveBeenCalledWith('terminal-existing') })
    expect(terminal.spawn).not.toHaveBeenCalled()
  })

  it('kills a terminal immediately when its tab closes without reopening it', async () => {
    const terminal = {
      list: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, sessions: [runningSession] } }),
      backends: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, backends: ['system'] } }),
      spawn: vi.fn(),
      kill: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, closed: true } }),
      input: vi.fn(), signal: vi.fn(),
    }
    const openInstance = vi.fn()
    const input = props(terminal, openInstance)
    const view = render(<TerminalPanel {...input} route="instance" tabs={['terminal-existing']} activeInstanceId="terminal-existing" />)

    await waitFor(() => { expect(terminal.list).toHaveBeenCalled() })
    view.rerender(<TerminalPanel {...input} route="home" tabs={[]} />)

    await waitFor(() => { expect(terminal.kill).toHaveBeenCalledWith('session-1', 'terminal-existing') })
    expect(terminal.kill).toHaveBeenCalledOnce()
    expect(terminal.spawn).not.toHaveBeenCalled()
    expect(openInstance).not.toHaveBeenCalled()
    expect(view.getByText('terminal.empty.title')).toBeTruthy()
  })

  it('names tabs after each PTY working directory and suffixes the title with the shell', async () => {
    const terminal = {
      list: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, sessions: [
        { sessionId: 't-1', type: 'system', status: { kind: 'running' as const }, interactive: true, shell: 'PowerShell', cwd: 'D:\\work\\dsh-deepcreator' },
        { sessionId: 't-2', type: 'system', status: { kind: 'running' as const }, interactive: true, shell: 'PowerShell', cwd: 'D:\\work\\myapp' },
        { sessionId: 't-3', type: 'system', status: { kind: 'running' as const }, interactive: true, shell: 'PowerShell', cwd: 'D:\\work\\myapp\\' },
        { sessionId: 't-4', type: 'system', status: { kind: 'running' as const }, interactive: false, shell: 'bash' },
      ] } }),
      backends: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, backends: ['system'] } }),
      spawn: vi.fn(), kill: vi.fn(), input: vi.fn(), signal: vi.fn(),
    }
    const contributePanelInfo = vi.fn(() => () => undefined)
    render(<TerminalPanel
      {...props(terminal)}
      route="instance"
      tabs={['t-1']}
      activeInstanceId="t-1"
      contributePanelInfo={contributePanelInfo}
    />)

    await waitFor(() => {
      expect(contributePanelInfo).toHaveBeenCalledWith({
        tabLabels: { 't-1': 'dsh-deepcreator', 't-2': 'myapp', 't-3': 'myapp 2', 't-4': 'bash' },
        titleSuffix: 'PowerShell',
      })
    })
  })
})
