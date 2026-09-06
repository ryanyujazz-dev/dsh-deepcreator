// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SettingsDescribeFace, SettingsDescribeView, SettingsMirrorSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { GeneralSectionComponentProps } from '../src/client/GeneralSection.tsx'
import { GeneralSection } from '../src/client/GeneralSection.tsx'
import { CloseLabel, HeaderContent, TriggerContent } from '../src/client/chrome.tsx'
import type { TriggerContentProps } from '../src/client/chrome.tsx'
import { SettingsDocumentAction } from '../src/client/SettingsDocumentAction.tsx'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

// The seat's key domain is settings ∪ common; the stub answers from the
// package dictionary and falls back to the key like the real chain.
const t: TriggerContentProps['t'] = key => (en as Record<string, string>)[key] ?? key

// Global standard kit stubs: none of these components consume the hooks.
const unusedHook = (() => { throw new Error('unused by settings-general components') }) as never
const kit = { useSessions: unusedHook, useWorkspaces: unusedHook }

describe('chrome content', () => {
  it('TriggerContent renders the icon with the label in the wide column', () => {
    const { container } = render(<TriggerContent {...kit} wide t={t} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14')
    expect(container.querySelector('svg')?.getAttribute('data-deepcreator-icon')).toBe('gearshape')
    expect(screen.getByText('Settings')).toBeTruthy()
  })

  it('TriggerContent drops the label in the rail state', () => {
    const { container } = render(<TriggerContent {...kit} wide={false} t={t} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14')
    expect(screen.queryByText('Settings')).toBeNull()
  })

  it('HeaderContent and CloseLabel render their translated text', () => {
    render(<HeaderContent {...kit} t={t} />)
    render(<CloseLabel {...kit} t={t} />)
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.getByText('Close')).toBeTruthy()
  })
})

describe('GeneralSection', () => {
  function mount() {
    const renderSlot = vi.fn(
      ((key: string) => <div data-testid={`slot-${key}`} />) as GeneralSectionComponentProps['renderSlot'],
    )
    const props: GeneralSectionComponentProps = { ...kit, renderSlot, close: vi.fn() }
    const view = render(<GeneralSection {...props} />)
    return { view, renderSlot }
  }

  it('renders the item slot as the section body', () => {
    const { renderSlot } = mount()
    expect(renderSlot).toHaveBeenCalledWith('settings.general.item', {})
    expect(screen.getByTestId('slot-settings.general.item')).toBeTruthy()
  })
})

describe('SettingsDocumentAction', () => {
  /** A held `settings.describe` answer the mirror would serve. */
  function view(hasDocument: boolean): SettingsDescribeView {
    return { writable: true, hasDocument, namespaces: [] }
  }

  /** In-memory `SettingsDescribeFace` double with mirror-refresh controls. */
  function stubDescribeFace(initial: Partial<SettingsMirrorSnapshot>): SettingsDescribeFace & {
    publish(next: Partial<SettingsMirrorSnapshot>): void
  } {
    const listeners = new Set<() => void>()
    let snapshot: SettingsMirrorSnapshot = { status: 'idle', view: undefined, error: null, ...initial }
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      ensure: () => Promise.resolve(),
      acceptView: () => undefined,
      publish(next) {
        snapshot = { ...snapshot, ...next }
        for (const listener of [...listeners]) listener()
      },
    }
  }

  /** The store wired over a face double and a stubbed `remote.settings` namespace. */
  function storeOver(
    face: SettingsDescribeFace,
    openSettingsDocument: () => Promise<unknown>,
  ): SettingsDocumentStore {
    return new SettingsDocumentStore(
      { remote: { settings: { openSettingsDocument } } } as never,
      face,
    )
  }

  it('appears only for a file-backed provider and requests its Host-owned document', async () => {
    const openSettingsDocument = vi.fn(() => Promise.resolve({ ok: true as const, value: { opened: true as const } }))
    const controller = storeOver(
      stubDescribeFace({ status: 'ready', view: view(true) }),
      openSettingsDocument,
    )
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    const action = await screen.findByRole('button', { name: 'Open configuration file' })
    fireEvent.click(action)
    await waitFor(() => { expect(openSettingsDocument).toHaveBeenCalledOnce() })
  })

  it('stays absent without a document and retries availability after remount', async () => {
    const face = stubDescribeFace({ status: 'ready', view: view(false) })
    const controller = storeOver(face, vi.fn())
    const first = render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    await waitFor(() => { expect(controller.store.getSnapshot().status).toBe('unavailable') })
    expect(screen.queryByRole('button', { name: 'Open configuration file' })).toBeNull()
    first.unmount()
    // The mirror refreshed while unmounted: a document appeared.
    face.publish({ status: 'ready', view: view(true) })
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    expect(await screen.findByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })

  it('keeps the action available and reports a native-open failure', async () => {
    const controller = storeOver(
      stubDescribeFace({ status: 'ready', view: view(true) }),
      vi.fn(() => Promise.resolve({
        ok: false as const,
        error: { code: 'internal' as const, message: 'xdg-open missing', details: {} },
      })),
    )
    render(<SettingsDocumentAction
      {...kit}
      t={t}
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
    />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open configuration file' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not open configuration file')
    expect(screen.getByRole('button', { name: 'Open configuration file' })).toBeTruthy()
  })
})
