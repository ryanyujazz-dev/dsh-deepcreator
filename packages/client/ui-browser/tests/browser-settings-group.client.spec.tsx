// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { BrowserSettingsGroup } from '../src/client/BrowserSettingsGroup.tsx'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('BrowserSettingsGroup', () => {
  it('owns one titled General Settings group for all Browser rows', () => {
    const browserSnapshot = { state: { sessionId: '', revision: 0, browsers: [], tabs: [] }, snapshotErrors: {} }
    const settingsSnapshot = {
      value: {
        defaultAutomation: 'playwright',
        playwrightDefaultEngine: 'chromium',
        visibleProviderOrder: ['iab', 'chrome', 'playwright-chromium'],
      },
    }
    const view = render(<BrowserSettingsGroup {...({
      remote: {},
      browser: {
        subscribe: () => () => undefined,
        getSnapshot: () => browserSnapshot,
        refresh: vi.fn(async () => undefined),
      },
      settings: {
        subscribe: () => () => undefined,
        getSnapshot: () => settingsSnapshot,
        set: vi.fn(async () => undefined),
      },
      t: (key: string) => key,
    } as never)} />)

    expect(view.getByRole('heading', { level: 2, name: 'browserSettings' })).toBeTruthy()
    for (const key of ['automationDefault', 'engineDefault', 'visibleDefault', 'clearData', 'providerStatus']) {
      expect(view.getByText(key)).toBeTruthy()
    }
    expect(view.getByRole('button', { name: 'expandProviders' }).getAttribute('aria-expanded')).toBe('false')
  })
})
