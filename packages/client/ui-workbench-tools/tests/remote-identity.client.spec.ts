import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('Terminal Remote identity', () => {
  it('captures the traced namespace once outside React renderers', () => {
    let namespaceReads = 0
    const namespace = {
      list: vi.fn(), backends: vi.fn(), spawn: vi.fn(), read: vi.fn(),
      readRaw: vi.fn(), input: vi.fn(), resize: vi.fn(), send: vi.fn(), signal: vi.fn(), kill: vi.fn(),
    }
    const remote = Object.defineProperty({}, 'terminal-workbench', {
      get() {
        namespaceReads += 1
        // Mirrors Cordis association tracing: every property read may expose a
        // distinct Proxy identity even though it represents one namespace.
        return Object.create(namespace) as typeof namespace
      },
    })
    const panels = new Map<string, (props: unknown) => ReactElement>()
    const dispose = () => undefined
    const ctx = {
      get: () => remote,
      locale: {
        bind: () => ((key: string) => key),
        register: () => dispose,
      },
      workbench: { registerType: () => dispose },
      slots: {
        inject: (_name: string, register: () => unknown) => register(),
        register: (entry: { name: string; id?: string }, component: (props: unknown) => ReactElement) => {
          if (entry.name === 'deepcreator.workbench.panel' && entry.id !== undefined) panels.set(entry.id, component)
          return dispose
        },
      },
      effect: (mount: () => unknown) => mount(),
    } as unknown as Context

    apply(ctx)
    const renderTerminal = panels.get('terminal')
    expect(renderTerminal).toBeDefined()
    const first = renderTerminal?.({})
    const second = renderTerminal?.({})

    expect(namespaceReads).toBe(1)
    expect(first?.props.terminal).toBe(second?.props.terminal)
  })
})
