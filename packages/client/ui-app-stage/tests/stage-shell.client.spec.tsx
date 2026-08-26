// @vitest-environment jsdom
/** Stage Shell render semantics: probe-at-open dev menu, ready-only opening,
 * sandboxed container, dock toggle pressed state. */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AppDevEntry, AppInstalledEntry, AppStageEnsureResult, AppStageListResult } from '@ryanyujazz/dsh-app-stage/types'
import type { AppStageRemote, StageShellProps } from '../src/client/contract.ts'
import type { StageRouterApi } from '../src/client/router.ts'
import { createStageRouter } from '../src/client/router.ts'
import { StageShell } from '../src/client/StageShell.tsx'

const t = (key: string): string => key === 'dev.menu.count' ? '开发中（{count}）' : key
const noSessions = { subscribe: () => () => {}, getSnapshot: () => undefined }
const session = (id: string) => ({ subscribe: () => () => {}, getSnapshot: () => id as never })

function devEntry(appId: string, status: AppDevEntry['status']): AppDevEntry {
  return {
    appId,
    status,
    conflictsWithInstalled: false,
    ...(status === 'ready'
      ? { manifest: { id: appId, platform: 'app-stage-v1', name: appId, version: '0.1.0', entry: 'index.html', dev: false, actions: [], permissions: [] } }
      : { reason: { code: 'gate.incomplete', detail: `entry index.html missing in ${appId}`, fix: 'Create the declared entry file.' } }),
  } as AppDevEntry
}

function remoteWith(dev: readonly AppDevEntry[], installed: readonly AppInstalledEntry[] = []): AppStageRemote & { ensureMock: ReturnType<typeof vi.fn> } {
  const ensureMock = vi.fn()
  const listResult: AppStageListResult = { ok: true, list: { installed, dev } }
  const ensureResult: AppStageEnsureResult = dev.find(entry => entry.status === 'ready') === undefined
    ? { ok: false, code: 'NOT_READY', message: 'not ready' }
    : { ok: true, url: `http://127.0.0.1:1/deepcreator-app-stage/dev/tok/index.html`, entry: dev.find(entry => entry.status === 'ready')! }
  const remote: AppStageRemote = {
    list: vi.fn(async () => ({ ok: true, value: listResult }) as RemoteResult<AppStageListResult>),
    ensure: ensureMock.mockImplementation(async () => ({ ok: true, value: ensureResult }) as RemoteResult<AppStageEnsureResult>),
  }
  return { ...remote, ensureMock }
}

function props(over: Partial<StageShellProps> = {}): StageShellProps {
  const router = over.router ?? routerWith(over.remote as AppStageRemote | undefined)
  return {
    phone: false,
    stageWidth: 1200,
    dockOpen: false,
    t,
    layout: { setDockOpen: vi.fn(), setStageMode: vi.fn() },
    sessions: noSessions,
    remote: remoteWith([]),
    scanTick: 0,
    router,
    ...over,
  } as StageShellProps
}

/** One fresh router per props build: a real router store over a stub env,
 * so container lifecycle assertions exercise the production path. */
function routerWith(remote?: AppStageRemote): StageRouterApi {
  return createStageRouter({
    remote: remote ?? remoteWith([]),
    session: () => undefined,
    onActivity: () => {},
    onPresent: () => {},
  }, () => (() => {}) as unknown as import('../../src/client/bridge.ts').BridgeHandle)
}

afterEach(cleanup)

describe('StageShell desktop', () => {
  it('shows the launcher empty state with no installed apps', () => {
    render(<StageShell {...props()} />)
    expect(screen.getByText('launcher.empty')).toBeDefined()
  })

  it('renders installed ready apps as launcher cards', async () => {
    const installed = [{
      appId: 'pub', status: 'ready',
      manifest: { id: 'pub', platform: 'app-stage-v1', name: '已发布', version: '1.0.0', entry: 'index.html', dev: false, actions: [], permissions: [] },
    }] as unknown as AppInstalledEntry[]
    const { findByText } = render(<StageShell {...props({ remote: remoteWith([], installed), sessions: session('s1') })} />)
    expect(await findByText('已发布')).toBeDefined()
  })
})

describe('StageShell dev menu', () => {
  it('counts only ready entries and lists reasons on gated rows', async () => {
    const remote = remoteWith([devEntry('ready-app', 'ready'), devEntry('broken', 'incomplete')])
    const { findByRole, findByText } = render(<StageShell {...props({ remote, sessions: session('s1') })} />)
    const trigger = await findByRole('button', { name: /开发中/ })
    trigger.click()
    expect(await findByText('ready-app')).toBeDefined()
    expect(await findByText('broken')).toBeDefined()
    expect(await findByText('gate.incomplete')).toBeDefined()
    expect(trigger.textContent).toContain('1')
  })

  it('shows the no-session hint inside the opened menu', async () => {
    const { findByRole, findByText } = render(<StageShell {...props({ sessions: noSessions })} />)
    ;(await findByRole('button', { name: /dev.menu/ })).click()
    expect(await findByText('dev.no-session')).toBeDefined()
  })

  it('opens a ready entry into the sandboxed container', async () => {
    const remote = remoteWith([devEntry('ready-app', 'ready')])
    const { findByRole, findByText } = render(<StageShell {...props({ remote, sessions: session('s1') })} />)
    ;(await findByRole('button', { name: /开发中/ })).click()
    const row = await findByRole('menuitem', { name: /ready-app/ })
    row.click()
    await waitFor(() => { expect(document.querySelector('iframe')).not.toBeNull() })
    const frame = document.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame.getAttribute('src')).toContain('/deepcreator-app-stage/dev/')
    expect(frame.getAttribute('title')).toBe('ready-app')
    expect(remote.ensureMock).toHaveBeenCalledWith('s1' as never, 'dev:ready-app')
  })
})

describe('StageShell top bar', () => {
  it('reflects the dock state on the toggle and writes through layout', async () => {
    const setDockOpen = vi.fn()
    const { findByRole } = render(<StageShell {...props({ dockOpen: true, layout: { setDockOpen, setStageMode: vi.fn() } })} />)
    const toggle = await findByRole('button', { name: 'dock.toggle.close' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    toggle.click()
    expect(setDockOpen).toHaveBeenCalledWith(false)
  })
})

describe('StageShell launcher (M3)', () => {
  const installedCard = (over: Partial<import('../src/client/contract.ts').LauncherCard> = {}) => ({
    appId: 'pub', name: '已发布', version: '1.0.0',
    ...over,
  })

  function remoteWithInstalled(installed: readonly import('@ryanyujazz/dsh-app-stage/types').AppInstalledEntry[], uninstall: ReturnType<typeof vi.fn>) {
    const remote = remoteWith([], installed) as unknown as AppStageRemote & { ensureMock: ReturnType<typeof vi.fn>; uninstall: ReturnType<typeof vi.fn> }
    remote.ensure = remote.ensureMock = vi.fn(async (_sessionId: unknown, ref: string) => ({
      ok: true,
      value: { ok: true, url: `http://127.0.0.1:1/deepcreator-app-stage/installed/pub/1.0.0/index.html#${ref}`, entry: installed[0] },
    })) as never
    remote.uninstall = uninstall
    return remote
  }

  it('opens an installed card through ensure with the bare id', async () => {
    const installed = [{
      appId: 'pub', status: 'ready', updatedSinceOpen: true,
      manifest: { id: 'pub', platform: 'app-stage-v1', name: '已发布', version: '1.0.0', entry: 'index.html', dev: false, actions: [], permissions: [] },
      pointer: { version: '1.0.0', digest: 'd', installedAt: 't', sourceWorkspace: '项目甲', sourceFingerprint: 'f', publishedVia: 'app_publish' },
    }] as unknown as import('@ryanyujazz/dsh-app-stage/types').AppInstalledEntry[]
    const uninstall = vi.fn(async () => ({ ok: true, value: { ok: true, appId: 'pub', removed: true } }) as never)
    const remote = remoteWithInstalled(installed, uninstall)
    const { findByRole, findByTitle, findByText } = render(<StageShell {...props({ remote, sessions: session('s1') })} />)
    // Source annotation + updated dot are visible before opening.
    expect(await findByText('launcher.source')).toBeDefined()
    expect(await findByTitle('launcher.updated')).toBeDefined()
    const card = await findByRole('button', { name: /已发布/ })
    card.click()
    await waitFor(() => { expect(document.querySelector('iframe')).not.toBeNull() })
    expect(remote.ensureMock).toHaveBeenCalledWith('s1' as never, 'pub')
    expect(uninstall).not.toHaveBeenCalled()
  })

  it('uninstalls through the two-step arm and rescans', async () => {
    const installed = [{
      appId: 'pub', status: 'ready',
      manifest: { id: 'pub', platform: 'app-stage-v1', name: '已发布', version: '1.0.0', entry: 'index.html', dev: false, actions: [], permissions: [] },
      pointer: { version: '1.0.0', digest: 'd', installedAt: 't', sourceWorkspace: '', sourceFingerprint: 'f', publishedVia: 'app_publish' },
    }] as unknown as import('@ryanyujazz/dsh-app-stage/types').AppInstalledEntry[]
    const uninstall = vi.fn(async () => ({ ok: true, value: { ok: true, appId: 'pub', removed: true } }) as never)
    const remote = remoteWithInstalled(installed, uninstall)
    const { findByRole, findByLabelText } = render(<StageShell {...props({ remote, sessions: session('s1') })} />)
    const remove = await findByLabelText('launcher.remove')
    // First click only arms.
    remove.click()
    expect(uninstall).not.toHaveBeenCalled()
    // Second click commits the removal.
    const armed = await findByRole('button', { name: 'launcher.remove', pressed: true } as never)
    armed.click()
    await waitFor(() => { expect(uninstall).toHaveBeenCalledWith('s1' as never, 'pub') })
  })
})
