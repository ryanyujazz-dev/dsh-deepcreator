// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelTypeDefinition, WorkbenchControlsProps } from '../src/client/contract.ts'
import { WorkbenchControls } from '../src/client/WorkbenchControls.tsx'

afterEach(cleanup)

const definitions: PanelTypeDefinition[] = ['Activity', 'Artifact', 'Review', 'Terminal', 'Preview'].map(label => ({
  id: label.toLowerCase(),
  label: () => label,
  scope: 'session',
  supportsHome: true,
  supportsCreate: false,
  supportsMultipleInstances: false,
  minWidth: 150,
  minHeight: 120,
  closePolicy: 'dispose',
}))

function props(panelControls: 'expanded' | 'compact') {
  const hide = vi.fn()
  const activate = vi.fn()
  const controller = {
    types: { list: () => definitions, subscribe: () => () => {}, version: () => 1 },
    visibility: { list: () => ['activity', 'review'], subscribe: () => () => {}, version: () => 1 },
    hide,
    activate,
  }
  return {
    value: {
      panelControls,
      addressed: false,
      controller,
      renderSlot: (_name: string, _owner: unknown, options?: { only?: string }) => <span aria-hidden>{options?.only}</span>,
      t: (key: string, params?: { type?: string }) => key === 'panels'
        ? '面板'
        : `${key === 'hide' ? '隐藏' : '打开'}${params?.type ?? ''}面板`,
    } as unknown as WorkbenchControlsProps,
    hide,
    activate,
  }
}

describe('WorkbenchControls responsive placement', () => {
  it('orders the entry strip by declared order, unordered types last', () => {
    // Registration order is Activity, Artifact, Review, Terminal, Preview;
    // the declared product priority is Terminal, Artifact, Activity, Review,
    // and Preview stays unordered to prove the registration-order fallback.
    const orders: Record<string, number> = { terminal: 1, artifact: 2, activity: 3, review: 4 }
    const registered = definitions.map(definition => ({
      ...definition,
      ...(definition.id in orders ? { order: orders[definition.id] } : {}),
    }))
    const controller = {
      types: { list: () => registered, subscribe: () => () => {}, version: () => 1 },
      visibility: { list: () => [], subscribe: () => () => {}, version: () => 1 },
      hide: vi.fn(), activate: vi.fn(),
    }
    const view = render(<WorkbenchControls {...{ ...props('expanded').value, controller } as unknown as WorkbenchControlsProps} />)
    const labels = view.getAllByRole('button').map(button => button.getAttribute('aria-label'))
    expect(labels).toEqual(['打开Terminal面板', '打开Artifact面板', '打开Activity面板', '打开Review面板', '打开Preview面板'])
  })

  it('shows every type button when the complete strip fits', () => {
    const input = props('expanded')
    const view = render(<WorkbenchControls {...input.value} />)
    expect(view.getByRole('button', { name: '隐藏Activity面板' })).toBeTruthy()
    expect(view.getByRole('button', { name: '打开Artifact面板' })).toBeTruthy()
    expect(view.getByRole('button', { name: '隐藏Review面板' })).toBeTruthy()
    expect(view.getAllByRole('button')).toHaveLength(5)
  })

  it('replaces the complete strip with one independent Panel menu', () => {
    const input = props('compact')
    const view = render(<WorkbenchControls {...input.value} />)
    const launcher = view.getByRole('button', { name: '面板' })
    expect(view.getAllByRole('button')).toHaveLength(1)
    expect(launcher.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(launcher)
    const review = view.getByRole('menuitem', { name: 'Review' })
    const terminal = view.getByRole('menuitem', { name: 'Terminal' })
    expect(view.getByRole('menuitem', { name: 'Activity' })).toBeTruthy()
    expect(view.getByRole('menuitem', { name: 'Preview' })).toBeTruthy()

    fireEvent.click(review)
    expect(input.hide).toHaveBeenCalledWith('review')
    expect(view.queryByRole('menuitem', { name: 'Terminal' })).toBeNull()
    fireEvent.click(launcher)
    fireEvent.click(view.getByRole('menuitem', { name: 'Terminal' }))
    expect(input.activate).toHaveBeenCalledWith('terminal')
  })
})
