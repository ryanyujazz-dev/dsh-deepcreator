// @vitest-environment jsdom
/** AppearanceRow behavior: real settings rows, persisted selection mirrors,
 * and segmented-control writes. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { AppearanceRowComponentProps } from '../src/client/AppearanceRow.tsx'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'
import type {
  CodeFont, DarkCodeTheme, LightCodeTheme, ThemePreference, TranscriptTextSize,
} from '../src/client/index.ts'

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
  'appearance.code.title': 'Code appearance',
  'appearance.code.description': 'Choose code themes.',
  'appearance.code.light': 'Light code theme',
  'appearance.code.dark': 'Dark code theme',
  'appearance.code.preview.light': 'Light code diff preview',
  'appearance.code.preview.dark': 'Dark code diff preview',
  'appearance.code.theme.deepcreatorLight': 'DeepCreator Light',
  'appearance.code.theme.deepcreatorDark': 'DeepCreator Dark',
  'appearance.code.theme.githubLight': 'GitHub Light',
  'appearance.code.theme.githubDark': 'GitHub Dark',
  'appearance.code.theme.oneLight': 'One Light',
  'appearance.code.theme.oneDark': 'One Dark',
  'appearance.code.theme.tokyoNightLight': 'Tokyo Light',
  'appearance.code.font.title': 'Code font',
  'appearance.code.font.description': 'Shared code and terminal font.',
  'appearance.code.font.system': 'System Mono',
  'appearance.code.font.jetbrains': 'JetBrains Mono',
  'appearance.code.font.fira': 'Fira Code',
  'appearance.code.font.source': 'Source Code Pro',
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
  lightCodeTheme: LightCodeTheme = 'deepcreator-light',
  darkCodeTheme: DarkCodeTheme = 'deepcreator-dark',
  codeFont: CodeFont = 'system',
) {
  // Real store instance — the sanctioned zero-machinery path for tests.
  const store = createAppearanceRowStore().create()
  store.actions.sync(preference, transcriptTextSize, lightCodeTheme, darkCodeTheme, codeFont, 0)
  const setTheme = vi.fn()
  const setTranscriptTextSize = vi.fn()
  const setLightCodeTheme = vi.fn()
  const setDarkCodeTheme = vi.fn()
  const setCodeFont = vi.fn()
  const props: AppearanceRowComponentProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    t: (key: string) => COPY[key] ?? key,
    renderSlot: ((key: string) => <div data-slot={key} />) as AppearanceRowComponentProps['renderSlot'],
    setTheme,
    setTranscriptTextSize,
    setLightCodeTheme,
    setDarkCodeTheme,
    setCodeFont,
  }
  render(<AppearanceRow {...props} />)
  return { store, setTheme, setTranscriptTextSize, setLightCodeTheme, setDarkCodeTheme, setCodeFont }
}

// Exact strings: the code selectors' accessible names ('Light code theme')
// must not collide with the segmented buttons' names.
const pressed = (name: string): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('AppearanceRow', () => {
  it('renders setting rows with the persisted segments selected', () => {
    mount('dark', 'large')
    expect(screen.getByText('Interface font')).toBeDefined()
    expect(screen.getByText('System font')).toBeDefined()
    expect(pressed('Dark')).toBe('true')
    expect(pressed('Light')).toBe('false')
    expect(pressed('System')).toBe('false')
    expect(pressed('Large')).toBe('true')
    expect(pressed('Standard')).toBe('false')
  })

  it('click drives setTheme; selection follows the store mirror, not the click echo', () => {
    const b = mount('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    expect(b.setTheme).toHaveBeenCalledWith('light')
    // No store write yet: selection is unchanged.
    expect(pressed('Dark')).toBe('true')
    act(() => { b.store.actions.sync('light', 'standard', 'deepcreator-light', 'deepcreator-dark', 'system', 1) })
    expect(pressed('Light')).toBe('true')
    expect(pressed('Dark')).toBe('false')
  })

  it('writes transcript size and waits for the service mirror before selecting it', () => {
    const b = mount('system', 'standard')
    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    expect(b.setTranscriptTextSize).toHaveBeenCalledWith('large')
    expect(pressed('Standard')).toBe('true')
    act(() => { b.store.actions.sync('system', 'large', 'deepcreator-light', 'deepcreator-dark', 'system', 1) })
    expect(pressed('Large')).toBe('true')
  })

  it('keeps the light and dark selectors independent and writes the shared code font', () => {
    const b = mount()
    const lightPreview = screen.getByLabelText('Light code diff preview')
    const darkPreview = screen.getByLabelText('Dark code diff preview')
    expect(lightPreview.hasAttribute('data-code-theme-isolate')).toBe(true)
    expect(darkPreview.hasAttribute('data-code-theme-isolate')).toBe(true)
    expect(lightPreview.getAttribute('data-code-theme-tone')).toBe('light')
    expect(darkPreview.getAttribute('data-code-theme-tone')).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Light code theme' }))
    expect(screen.getByRole('menuitem', { name: 'Tokyo Light' })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: 'GitHub Light' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dark code theme' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'One Dark' }))
    fireEvent.click(screen.getByRole('button', { name: 'Code font' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'JetBrains Mono' }))
    expect(b.setLightCodeTheme).toHaveBeenCalledWith('github-light')
    expect(b.setDarkCodeTheme).toHaveBeenCalledWith('one-dark')
    expect(b.setCodeFont).toHaveBeenCalledWith('jetbrains-mono')
  })

  it('keeps the preview surface and diff chrome independent from the application palette', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-theme/src/client/AppearanceRow.module.css'), 'utf8')

    expect(stylesheet).toMatch(/\.preview :global\(\[data-diff-hunk\]\)\s*\{[^}]*background:\s*transparent;/s)
    expect(stylesheet).toMatch(/\.preview\[data-code-theme-tone='light'\]\s*\{[^}]*--dsw-alias-label-tertiary:/s)
    expect(stylesheet).toMatch(/\.preview\[data-code-theme-tone='dark'\]\s*\{[^}]*--dsw-alias-label-tertiary:/s)
  })
})
