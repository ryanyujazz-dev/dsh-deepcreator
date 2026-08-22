// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, type SessionListState, type WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DefaultRenderModeRow } from '../src/client/settings/DefaultRenderModeRow.tsx'
import type { DefaultRenderModeRowProps } from '../src/client/settings/DefaultRenderModeRow.tsx'
import { RenderModePreference } from '../src/client/chat/render-mode-preference.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

describe('DefaultRenderModeRow', () => {
  it('renders the three concise options and writes the selected default', () => {
    const preference = new RenderModePreference()
    const setDefaultRenderMode = vi.fn((mode: 'normal' | 'classic' | 'think') => { preference.set(mode) })
    const props: DefaultRenderModeRowProps = {
      useSessions: emptySessions(),
      useWorkspaces: emptyWorkspaces(),
      useDefaultRenderMode: bindSnapshotSelector(preference.value),
      setDefaultRenderMode,
      t: makeTranslate(zh),
    }
    render(<DefaultRenderModeRow {...props} />)
    expect(screen.getByText('默认渲染模式')).toBeTruthy()
    expect(screen.getByRole('button', { name: '经典' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '思考' }))
    expect(setDefaultRenderMode).toHaveBeenCalledWith('think', undefined)
    expect(screen.getByRole('button', { name: '思考' }).getAttribute('aria-pressed')).toBe('true')
  })
})
