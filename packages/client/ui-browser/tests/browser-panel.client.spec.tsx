// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { BrowserPanel } from '../src/client/BrowserPanel.tsx'
import { BrowserClientRuntime } from '../src/client/runtime.ts'
import type { BrowserRemoteClient, BrowserSurfaceBridge } from '../src/client/runtime.ts'

let notifyResize = (): void => {}
class ResizeObserverStub {
  readonly #callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) { this.#callback = callback; notifyResize = () => this.#callback([], this as unknown as ResizeObserver) }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => { notifyResize = () => {}; vi.stubGlobal('ResizeObserver', ResizeObserverStub) })
afterEach(() => { cleanup(); delete window.deepcreatorBrowserSurface; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('BrowserPanel live surface', () => {
  it('commits the selected live tab and mounts its exact native surface', async () => {
    let finishMount = (): void => {}
    let panelWidth = 240
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 760, y: 42, width: panelWidth, height: 600, top: 42, right: 760 + panelWidth, bottom: 642, left: 760,
      toJSON() { return this },
    } as DOMRect))
    const bridge: BrowserSurfaceBridge = {
      mount: vi.fn(() => new Promise<void>(resolve => { finishMount = resolve })),
      setBounds: vi.fn(async () => undefined),
      setVisible: vi.fn(async () => undefined),
      unmount: vi.fn(async () => undefined),
    }
    window.deepcreatorBrowserSurface = bridge
    const remote = {
      state: vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: {
        sessionId: 'agent-1', revision: 1, browsers: [], selectedTabId: 'tab-1',
        tabs: [{
          tabId: 'tab-1', browserId: 'iab', url: 'https://example.test/', title: 'Example', loading: false,
          canGoBack: false, canGoForward: false, lifecycle: 'temporary' as const, presentation: 'live' as const,
          controlState: 'presentation-required' as const, presentationState: 'pending' as const, surfaceId: 'surface-1',
        }],
      } } })),
    } as unknown as BrowserRemoteClient
    const browser = new BrowserClientRuntime(remote, () => 'agent-1' as never)
    await browser.refresh()
    const contributePanelInfo = vi.fn(() => () => undefined)

    render(<BrowserPanel {...({
      browser, typeId: 'browser', route: 'instance', tabs: ['tab-1'], activeInstanceId: 'tab-1', visible: true,
      openInstance: vi.fn(), contributePanelInfo, t: (key: string) => key,
    } as never)} />)

    await waitFor(() => expect(bridge.mount).toHaveBeenCalledWith('surface-1', { x: 760, y: 42, width: 240, height: 600 }))
    // Workbench finishes a width transition while Electron is still mounting.
    panelWidth = 480
    act(() => notifyResize())
    expect(bridge.setBounds).not.toHaveBeenCalled()
    await act(async () => finishMount())
    await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledWith('surface-1', { x: 760, y: 42, width: 480, height: 600 }))

    // Later splitter/window changes continue to update the exact native viewport width.
    panelWidth = 640
    act(() => notifyResize())
    await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledWith('surface-1', { x: 760, y: 42, width: 640, height: 600 }))
    await waitFor(() => expect(browser.waitForSurface('tab-1', 20)).resolves.toEqual({ ok: true }))
    expect(document.body.textContent).toContain('https://example.test/')
    expect(contributePanelInfo).toHaveBeenCalledWith({ tabLabels: { 'tab-1': 'Example' } })
    browser.dispose()
  })
})
