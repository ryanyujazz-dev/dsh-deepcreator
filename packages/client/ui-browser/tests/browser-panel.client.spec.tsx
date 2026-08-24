// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
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

describe('BrowserPanel', () => {
  it('shows synchronization instead of a false stale page before the current Session snapshot arrives', () => {
    const browser = new BrowserClientRuntime({ state: vi.fn() } as unknown as BrowserRemoteClient, () => 'agent-current' as never)
    const view = render(<BrowserPanel {...({
      browser, createTab: vi.fn(), typeId: 'browser', route: 'instance', tabs: ['tab-current'], activeInstanceId: 'tab-current', visible: true,
      openInstance: vi.fn(), contributeHeaderActions: () => () => undefined, contributePanelInfo: () => () => undefined, t: (key: string) => key,
    } as never)} />)

    expect(view.getByText('loading')).toBeTruthy()
    expect(view.queryByText('stale')).toBeNull()
    browser.dispose()
  })

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
      openInstance: vi.fn(), createTab: vi.fn(), contributeHeaderActions: () => () => undefined, contributePanelInfo, t: (key: string) => key,
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
    expect((document.querySelector('input[aria-label="addressLabel"]') as HTMLInputElement).value).toBe('https://example.test/')
    expect(contributePanelInfo).toHaveBeenCalledWith({ tabLabels: { 'tab-1': 'Example' } })
    browser.dispose()
  })

  it('distinguishes a missing screenshot from a failed preview and retries it explicitly', async () => {
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: {
      sessionId: 'agent-1', revision: 1, browsers: [], selectedTabId: 'tab-1',
      tabs: [{
        tabId: 'tab-1', browserId: 'playwright-chromium', url: 'https://example.test/', title: 'Example', loading: false,
        canGoBack: false, canGoForward: false, lifecycle: 'deliverable' as const, presentation: 'snapshot' as const,
        presentationBinding: { owner: 'deepcreator' as const, mode: 'snapshot' as const, requiredBeforeControl: false },
        controlState: 'ready' as const, presentationState: 'presented' as const,
        snapshotAttachment: { attachmentId: 'shot-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 },
      }],
    } } }))
    const snapshotImage = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, value: { ok: false as const, code: 'BROWSER_UNAVAILABLE' as const, message: 'preview failed' } })
      .mockResolvedValueOnce({ ok: true as const, value: { ok: true as const, value: { attachment: { attachmentId: 'shot-1', mediaType: 'image/png', bytes: 3, width: 1, height: 1 }, dataUrl: 'data:image/png;base64,cG5n' } } })
    const browser = new BrowserClientRuntime({ state, snapshotImage } as unknown as BrowserRemoteClient, () => 'agent-1' as never)
    await browser.refresh()
    const view = render(<BrowserPanel {...({
      browser, typeId: 'browser', route: 'instance', tabs: ['tab-1'], activeInstanceId: 'tab-1', visible: true,
      openInstance: vi.fn(), createTab: vi.fn(), contributeHeaderActions: () => () => undefined, contributePanelInfo: () => () => undefined, t: (key: string) => key,
    } as never)} />)

    expect(view.getByText(/snapshotFailed: BROWSER_UNAVAILABLE: preview failed/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'retry' }))
    await waitFor(() => expect(view.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cG5n'))
    expect(view.queryByText('snapshotEmpty')).toBeNull()
    browser.dispose()
  })

  it('contributes a Home create action and closes an unpresented tab from its list row', async () => {
    let closed = false
    const tab = {
      tabId: 'tab-1', browserId: 'iab', url: '', title: '', loading: false, canGoBack: false, canGoForward: false,
      lifecycle: 'deliverable' as const, presentation: 'live' as const,
      presentationBinding: { owner: 'deepcreator' as const, mode: 'live' as const, requiredBeforeControl: true },
      controlState: 'ready' as const, presentationState: 'presented' as const, surfaceId: 'surface-1',
    }
    const presented = { ...tab, tabId: 'tab-presented', title: 'Presented', surfaceId: 'surface-presented' }
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: {
      sessionId: 'agent-1', revision: closed ? 2 : 1, browsers: [], tabs: closed ? [presented] : [tab, presented],
    } } }))
    const closeTab = vi.fn(async (_sessionId: string, tabId: string) => { closed = true; return { ok: true as const, value: { ok: true as const, value: { closed: true as const, tabId } } } })
    const browser = new BrowserClientRuntime({ state, closeTab } as unknown as BrowserRemoteClient, () => 'agent-1' as never)
    await browser.refresh()
    const createTab = vi.fn(async () => 'tab-created')
    const closeInstance = vi.fn()
    const openInstance = vi.fn()
    let actions: { left?: ReactNode } = {}
    const view = render(<BrowserPanel {...({
      browser, createTab, typeId: 'browser', route: 'home', tabs: ['tab-presented'], visible: true,
      openInstance, closeInstance, contributeHeaderActions: (value: typeof actions) => { actions = value; return () => undefined },
      contributePanelInfo: () => () => undefined, t: (key: string) => key,
    } as never)} />)

    await waitFor(() => expect(actions.left).toBeDefined())
    const header = render(<>{actions.left}</>)
    fireEvent.click(header.container.querySelector('button[aria-label="newTab"]')!)
    await waitFor(() => expect(createTab).toHaveBeenCalledOnce())
    await waitFor(() => expect(openInstance).toHaveBeenCalledWith('tab-created'))

    fireEvent.click(view.getByRole('button', { name: 'closeTab: Presented' }))
    expect(closeInstance).toHaveBeenCalledWith('tab-presented')
    expect(closeTab).not.toHaveBeenCalled()

    fireEvent.click(view.getByRole('button', { name: 'closeTab: newTab' }))
    await waitFor(() => expect(closeTab).toHaveBeenCalledWith('agent-1', 'tab-1'))
    await waitFor(() => expect(view.queryByRole('button', { name: 'closeTab: newTab' })).toBeNull())
    browser.dispose()
  })

  it('normalizes a user-entered address and navigates the exact live tab', async () => {
    let url = ''
    let revision = 1
    const tab = () => ({
      tabId: 'tab-1', browserId: 'iab', url, title: '', loading: false, canGoBack: false, canGoForward: false,
      lifecycle: 'deliverable' as const, presentation: 'live' as const,
      presentationBinding: { owner: 'deepcreator' as const, mode: 'live' as const, requiredBeforeControl: true },
      controlState: 'interrupted' as const, presentationState: 'presented' as const, surfaceId: 'surface-1',
    })
    const state = vi.fn(async () => ({ ok: true as const, value: { ok: true as const, value: {
      sessionId: 'agent-1', revision, browsers: [], tabs: [tab()],
    } } }))
    const navigateTab = vi.fn(async (_sessionId: string, _tabId: string, nextUrl: string) => {
      url = nextUrl; revision++
      return { ok: true as const, value: { ok: true as const, value: { tab: tab() } } }
    })
    const browser = new BrowserClientRuntime({ state, navigateTab } as unknown as BrowserRemoteClient, () => 'agent-1' as never)
    await browser.refresh()
    const view = render(<BrowserPanel {...({
      browser, createTab: vi.fn(), typeId: 'browser', route: 'instance', tabs: ['tab-1'], activeInstanceId: 'tab-1', visible: true,
      openInstance: vi.fn(), contributeHeaderActions: () => () => undefined, contributePanelInfo: () => () => undefined, t: (key: string) => key,
    } as never)} />)

    fireEvent.change(view.getByRole('textbox', { name: 'addressLabel' }), { target: { value: 'example.test/path' } })
    fireEvent.submit(view.getByRole('textbox', { name: 'addressLabel' }).closest('form')!)
    await waitFor(() => expect(navigateTab).toHaveBeenCalledWith('agent-1', 'tab-1', 'https://example.test/path'))
    await waitFor(() => expect((view.getByRole('textbox', { name: 'addressLabel' }) as HTMLInputElement).value).toBe('https://example.test/path'))
    browser.dispose()
  })
})
