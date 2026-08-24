// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { BrowserDataSetting } from '../src/client/BrowserDataSetting.tsx'
import type { BrowserClientRuntime, BrowserRemoteClient } from '../src/client/runtime.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('BrowserDataSetting', () => {
  it('keeps provider details collapsed until the summary row is opened', () => {
    const snapshot = {
      state: {
        sessionId: 'agent-1', revision: 1, tabs: [],
        browsers: [
          { browserId: 'chrome', name: 'System Chrome', availability: 'available', capabilities: ['management.install'] },
          { browserId: 'playwright-webkit', name: 'Managed Playwright webkit', availability: 'unavailable', capabilities: ['management.install'], diagnostic: 'Browser Pack is not installed.' },
        ],
      },
      snapshotErrors: {},
    }
    const browser = {
      subscribe: () => () => undefined,
      getSnapshot: () => snapshot,
      refresh: vi.fn(async () => undefined),
    } as unknown as BrowserClientRuntime
    const view = render(<BrowserDataSetting {...({
      remote: {} as BrowserRemoteClient,
      browser,
      t: (key: string) => key,
    } as never)} />)

    const toggle = view.getByRole('button', { name: 'expandProviders' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('providerStatus')).toBeTruthy()
    expect(view.queryByText('System Chrome')).toBeNull()
    expect(view.queryByText('Managed Playwright webkit')).toBeNull()

    fireEvent.click(toggle)
    expect(view.getByRole('button', { name: 'collapseProviders' }).getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('System Chrome')).toBeTruthy()
    expect(view.getByText('Managed Playwright webkit')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'collapseProviders' }))
    expect(view.queryByText('System Chrome')).toBeNull()
  })
})
