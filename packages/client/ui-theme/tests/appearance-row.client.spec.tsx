// @vitest-environment jsdom
/** AppearanceRow behavior: real settings rows, persisted selection mirrors,
 * and segmented-control writes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type { ThemePreference, TranscriptTextSize } from '../src/client/index.ts'

afterEach(cleanup)

const COPY: Record<string, string> = {
  'appearance.title': 'Preferences',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
  'appearance.color.title': 'Color mode',
  'appearance.color.description': 'Choose a light, dark, or system palette.',
  'appearance.interfaceFont.title': 'Interface font',
  'appearance.interfaceFont.description': 'Font for interface chrome.',
  'appearance.interfaceFont.system': 'System font',
  'appearance.transcript.title': 'Text size',
  'appearance.transcript.description': 'Size of conversation and sidebar text.',
  'appearance.transcript.small': 'Small',
  'appearance.transcript.standard': 'Standard',
  'appearance.transcript.large': 'Large',
}

/** Empty global standard-kit hooks (the row reads neither). */
function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(
  preference: ThemePreference = 'system',
  transcriptTextSize: TranscriptTextSize = 'standard',
) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, transcriptTextSize, 0)
  const setTheme = vi.fn()
  const setTranscriptTextSize = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    renderSlot: ((key: string) => <div data-slot={key} />) as AppearanceRowComponentProps['renderSlot'],
    setTheme,
    setTranscriptTextSize,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setTranscriptTextSize }
}

const pressed = (name: RegExp): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AppearanceRow', () => {
  it('renders setting rows with the persisted segments selected', () => {
    mount('dark', 'large')
    expect(screen.getByText('Interface font')).toBeDefined()
    expect(screen.getByText('System font')).toBeDefined()
    expect(pressed(/Dark/)).toBe('true')
    expect(pressed(/Light/)).toBe('false')
    expect(pressed(/System/)).toBe('false')
    expect(pressed(/Large/)).toBe('true')
    expect(pressed(/Standard/)).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: /Light/ }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed(/Dark/)).toBe('true')
    act(() => { b.store.actions.sync('light', 'standard', 1) })
    expect(pressed(/Light/)).toBe('true')
    expect(pressed(/Dark/)).toBe('false')
  })

  it('writes transcript size and waits for the service mirror before selecting it', () => {
    const b = mount('system', 'standard')
    fireEvent.click(screen.getByRole('button', { name: /Large/ }))
    expect(b.setTranscriptTextSize).toHaveBeenCalledWith('large')
    expect(pressed(/Standard/)).toBe('true')
    act(() => { b.store.actions.sync('system', 'large', 1) })
    expect(pressed(/Large/)).toBe('true')
  })
})
