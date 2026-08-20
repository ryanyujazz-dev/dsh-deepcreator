// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PanelTypeDefinition, WorkbenchPanelOwnerProps, WorkbenchRootProps } from '../src/client/contract.ts'
import { WorkbenchController } from '../src/client/service.ts'
import { createWorkbenchStore } from '../src/client/store.ts'
import { WorkbenchRoot } from '../src/client/WorkbenchRoot.tsx'

beforeEach(() => { localStorage.clear() })
afterEach(cleanup)

const definitions: PanelTypeDefinition[] = [
  { id: 'review', label: () => 'Review', scope: 'workspace', supportsHome: true, supportsCreate: false, supportsMultipleInstances: true, minWidth: 150, minHeight: 200, closePolicy: 'dispose' },
  { id: 'artifact', label: () => 'Artifact', scope: 'session', supportsHome: true, supportsCreate: false, supportsMultipleInstances: true, minWidth: 150, minHeight: 200, closePolicy: 'detach' },
]

/** The framework supplies useStore/actions from the declared store; the test
 *  synthesizes the same selector-hook + baked-actions pair from one instance. */
function mountRoot(beforeRender?: (controller: WorkbenchController) => void) {
  const layout = {
    toggleSidebar: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn(),
    setWorkbenchWidth: vi.fn(), setWorkbenchFocused: vi.fn(),
  }
  const controller = new WorkbenchController(new Context(), layout as never)
  for (const definition of definitions) controller.registerType(definition)
  beforeRender?.(controller)
  const instance = createWorkbenchStore().create('spec')
  const owners = new Map<string, WorkbenchPanelOwnerProps>()
  const useStore = (selector: (state: unknown) => unknown) => useSyncExternalStore(
    instance.subscribe, () => selector(instance.getSnapshot()),
  )
  const view = render(<WorkbenchRoot {...{
    useStore,
    actions: instance.actions,
    renderSlot: (name: string, owner: unknown, options?: { only?: string }) => {
      if (name !== 'deepcreator.workbench.panel' || options?.only === undefined) return null
      owners.set(options.only, owner as WorkbenchPanelOwnerProps)
      return <div data-panel={options.only} />
    },
    controller,
    width: 1200,
    stageWidth: 1600,
    resizeGesture: null,
    t: (key: string) => key,
  } as unknown as WorkbenchRootProps} />)
  return { controller, owners, view }
}

describe('WorkbenchRoot reveal delivery', () => {
  it('does not replay a panel command retained from before this session root mounted', async () => {
    const { controller, owners } = mountRoot(controller => { controller.activate('review') })

    // The controller keeps its latest command for useSyncExternalStore, but a
    // freshly mounted session treats that sequence as its initial watermark.
    expect(owners.get('review')).toBeUndefined()

    // Commands published after mount still behave normally.
    await act(() => { controller.activate('artifact') })
    expect(owners.get('artifact')).toBeDefined()
    expect(owners.get('review')).toBeUndefined()
  })

  it('presents the panel and carries the target only to the addressed type', async () => {
    const { controller, owners } = mountRoot()
    await act(() => { controller.activate('review') })
    expect(owners.get('review')).toBeDefined()
    // Activation carries no target, so no reveal owner share exists.
    expect(owners.get('review')?.reveal).toBeUndefined()

    await act(() => { controller.reveal('review', '/repo/src/app.ts') })
    const first = owners.get('review')?.reveal
    expect(first).toMatchObject({ target: '/repo/src/app.ts' })
    expect(typeof first?.nonce).toBe('number')

    // Another presented type never receives the addressed type's reveal.
    await act(() => { controller.activate('artifact') })
    await act(() => { controller.reveal('review', '/repo/src/other.ts') })
    expect(owners.get('artifact')?.reveal).toBeUndefined()
    const second = owners.get('review')?.reveal
    expect(second).toMatchObject({ target: '/repo/src/other.ts' })
    expect(second !== undefined && first !== undefined && second.nonce).toBeGreaterThan(first.nonce)

    // A later target-less command clears the share instead of replaying it.
    await act(() => { controller.hide('review') })
    expect(owners.get('review')?.reveal).toBeUndefined()
    // Hidden groups stay mounted but their owner reports invisible.
    expect(owners.get('review')?.visible).toBe(false)
    expect(owners.get('artifact')?.visible).toBe(true)
  })
})
