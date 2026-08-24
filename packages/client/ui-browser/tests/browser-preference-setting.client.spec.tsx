// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BrowserPreferenceSetting } from '../src/client/BrowserPreferenceSetting.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('BrowserPreferenceSetting', () => {
  it('uses the shared Menu control and writes the selected preference', () => {
    const set = vi.fn(async () => undefined)
    const snapshot = {
      value: {
        defaultAutomation: 'playwright',
        playwrightDefaultEngine: 'chromium',
        visibleProviderOrder: ['iab', 'chrome', 'playwright-chromium'],
      },
    }
    const view = render(<BrowserPreferenceSetting {...({
      settings: {
        subscribe: () => () => undefined,
        getSnapshot: () => snapshot,
        set,
      },
      t: (key: string) => key,
    } as never)} />)

    expect(view.queryByRole('combobox')).toBeNull()
    expect(view.getByRole('button', { name: 'automationDefault' }).textContent).toContain('Playwright')
    expect(view.getByRole('button', { name: 'engineDefault' }).textContent).toContain('Chromium')
    expect(view.getByRole('button', { name: 'visibleDefault' }).textContent).toContain('visibleIab')

    fireEvent.click(view.getByRole('button', { name: 'automationDefault' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Semantic' }))
    expect(set).toHaveBeenCalledWith('defaultAutomation', 'semantic')
  })
})
