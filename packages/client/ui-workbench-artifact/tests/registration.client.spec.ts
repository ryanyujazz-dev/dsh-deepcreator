import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('ui-workbench-artifact registration', () => {
  it('registers one atomic provider and disposes every row in reverse', () => {
    let namespaceReads = 0
    const namespace = { read: vi.fn() }
    const remote = Object.defineProperty({}, 'artifacts', {
      get() {
        namespaceReads += 1
        // Mirrors Cordis association tracing: every property read may expose a
        // distinct Proxy identity even though it represents one namespace.
        return Object.create(namespace)
      },
    })
    const panels = new Map<string, (props: unknown) => ReactElement>()
    const icons = new Map<string, (props: unknown) => ReactElement>()
    const typeDefinitions: Array<Record<string, unknown>> = []
    const nodeDefinitions: Array<{ kind?: string; target?: string }> = []
    const viewDefinitions: Array<{ target?: string }> = []
    const injectedSlots: string[] = []
    const localeNamespaces: string[] = []
    const disposed: string[] = []
    const dispose = (tag: string) => () => { disposed.push(tag) }

    let teardown: (() => void) | undefined
    const ctx = {
      get: () => remote,
      locale: {
        bind: () => (key: string) => key,
        register: (ns: string) => { localeNamespaces.push(ns); return dispose(`locale:${ns}`) },
      },
      workbench: { registerType: (definition: Record<string, unknown>) => { typeDefinitions.push(definition); return dispose(`type:${String(definition.id)}`) } },
      slots: {
        inject: (name: string, register: () => unknown) => { injectedSlots.push(name); register(); return dispose(`inject:${name}`) },
        register: (entry: { name: string; id?: string }, component: (props: unknown) => ReactElement) => {
          if (entry.name === 'deepcreator.workbench.panel' && entry.id !== undefined) panels.set(entry.id, component)
          if (entry.name === 'deepcreator.workbench.panel-icon' && entry.id !== undefined) icons.set(entry.id, component)
          return dispose(`slot:${entry.name}:${entry.id ?? ''}`)
        },
      },
      conversationEvents: { register: (definition: { kind?: string }) => { nodeDefinitions.push(definition); return dispose('node') } },
      conversationViews: { register: (definition: { target?: string }) => { viewDefinitions.push(definition); return dispose('view') } },
      effect: (mount: () => (() => void) | void) => { teardown = mount() ?? (() => undefined); return teardown },
    } as unknown as Context

    apply(ctx)

    // Provider surface: type 'artifact' keeps the persisted field values.
    expect(typeDefinitions).toHaveLength(1)
    expect(typeDefinitions[0]).toMatchObject({
      id: 'artifact', order: 2, scope: 'session', closePolicy: 'detach',
      supportsHome: true, supportsMultipleInstances: true,
    })
    expect(injectedSlots).toEqual(['deepcreator.workbench.panel', 'deepcreator.workbench.panel-icon'])
    expect(panels.has('artifact')).toBe(true)
    expect(icons.has('artifact')).toBe(true)
    expect(nodeDefinitions[0]).toMatchObject({ kind: 'workbench-artifact', target: 'artifacts' })
    expect(viewDefinitions[0]).toMatchObject({ target: 'artifacts' })
    expect(localeNamespaces).toEqual(['workbench-artifact'])

    // The traced namespace is captured once, outside every React renderer.
    const render = panels.get('artifact')!
    const first = render({})
    const second = render({})
    expect(namespaceReads).toBe(1)
    expect(first?.props.artifacts).toBe(second?.props.artifacts)

    // Disposal unwinds every registration in reverse order.
    expect(disposed).toEqual([])
    teardown!()
    expect(disposed).toEqual([
      'locale:workbench-artifact', 'view', 'node',
      'inject:deepcreator.workbench.panel-icon',
      'inject:deepcreator.workbench.panel',
      'type:artifact',
    ])
  })
})
