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
    activateInstance: vi.fn(),
    closeInstance: vi.fn(),
    showHome: vi.fn(),
    contributeHeaderActions: () => () => undefined,
    renderArtifact: () => null,
    t: (key: string) => key,
  } as ComponentProps<typeof TerminalPanel>
}

describe('Terminal Panel initialization', () => {
  it('spawns and opens the first terminal tab automatically', async () => {
    const terminal = {
      list: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, sessions: [] } }),
      backends: vi.fn().mockResolvedValue({ ok: true, value: { ok: true, backends: ['system'] } }),
      spawn: vi.fn().mockResolvedValue({
        ok: true,
        value: { ok: true, session: { ...runningSession, sessionId: 'terminal-new', motd: '' } },
      }),
      kill: vi.fn(), input: vi.fn(), signal: vi.fn(),
    }
    const openInstance = vi.fn()
    render(<TerminalPanel {...props(terminal, openInstance)} />)

    await waitFor(() => { expect(terminal.spawn).toHaveBeenCalledWith('session-1', { type: 'system', name: 'Workbench' }) })
    await waitFor(() => { expect(openInstance).toHaveBeenCalledWith('terminal-new') })
    expect(terminal.spawn).toHaveBeenCalledOnce()
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
})
