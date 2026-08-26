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
import { createPresenceFeed } from '../src/client/presence.ts'
import type { PresenceLeaseSnapshot } from '@ryanyujazz/dsh-app-stage/types'
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
    presenceTimeline: vi.fn(async () => ({ ok: true, value: { ok: true, rows: [], latest: 0 } }) as never),
    presenceSeen: vi.fn(async () => ({ ok: true, value: { ok: true, seen: 0, latest: 0 } }) as never),
    presenceMarkSeen: vi.fn(async () => ({ ok: true, value: { ok: true, seen: 0 } }) as never),
    installedHistory: vi.fn(async () => ({ ok: true, value: { ok: true, records: [] } }) as never),
    rollbackInstalled: vi.fn(async () => ({ ok: true, value: { ok: true, appId: 'a', version: '0.1.0' } }) as never),
    importPrepare: vi.fn(async () => ({ ok: true, value: { ok: false, code: 'IMPORT_PATH_INVALID', message: 'x' } }) as never),
    importCommit: vi.fn(async () => ({ ok: true, value: { ok: true, appId: 'a', version: '0.1.0', plan: 'first' } }) as never),
    importAbort: vi.fn(async () => ({ ok: true, value: { ok: true, dropped: false } }) as never),
  }
  return { ...remote, ensureMock }
}

function presenceWith(leases: readonly PresenceLeaseSnapshot[], controls: { presenceControl?: ReturnType<typeof vi.fn> } = {}): {
  feed: import('../src/client/presence.ts').PresenceFeedApi
  control: ReturnType<typeof vi.fn>
} {
  const control = controls.presenceControl ?? vi.fn(async () => ({ ok: true, value: { ok: true, applied: true } }))
  const face = {
    presenceSnapshot: vi.fn(async () => ({ ok: true, value: { ok: true, leases } })),
    presenceControl: control,
    presenceSummary: vi.fn(async () => ({ ok: true, value: { ok: false, code: 'UNKNOWN_LEASE', message: 'none' } })),
  }
  return { feed: createPresenceFeed({ remote: face, session: () => 's-1' as never }), control }
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
    presence: over.presence ?? presenceWith([]).feed,
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


// React 19 ignores a cleanup returned from a callback ref: attaching the
// bridge there never detaches, and a remount stacks a second dispatch
// path on the same frame (one invoke executes twice). The shell binds
// through useEffect — one attach per (frame, container), detach on swap.
it('binds the container frame once and rebinds on container swap', async () => {
  const bound: string[] = []
  const detached: string[] = []
  const remote = remoteWith([])
  const factory = (frame: HTMLIFrameElement, ref: string): import('../src/client/bridge.ts').BridgeHandle => {
    void frame
    const n = bound.length + detached.length + 1
    bound.push(`${ref}#${n}`)
    return Object.assign(() => { detached.push(`${ref}#${n}`) }, {
      actions: new Set<string>(),
      waitForAction: async () => {},
      invoke: async () => ({ ok: true, result: null }),
    }) as unknown as import('../src/client/bridge.ts').BridgeHandle
  }
  const router = createStageRouter({ remote, session: () => undefined, onActivity: () => {}, onPresent: () => {} }, factory as unknown as never)
  render(<StageShell {...props({ remote, router, sessions: session('s1') })} />)
  router.openFromUser({ appId: 'a', name: 'a', version: '0.1.0', url: '/x', dev: false, ref: 'a' })
  await waitFor(() => { expect(bound).toEqual(['a#1']) })
  router.openFromUser({ appId: 'b', name: 'b', version: '0.1.0', url: '/y', dev: false, ref: 'b' })
  await waitFor(() => { expect(detected()).toBe(true) })
  function detected(): boolean { return detached.length >= 1 && bound.length === 2 }
})

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

describe('presence banner (Px-β shell chrome)', () => {
  const tZh = (key: string, vars?: Record<string, string>): string => {
    const map: Record<string, string> = {
      'presence.acting': 'AI 正在操作 {name}',
      'presence.takeover': 'AI 接管中 · {name}',
      'presence.paused': '已暂停 · AI 让位',
      'presence.control.pause': '暂停 AI',
      'presence.control.resume': '继续',
      'presence.control.handback': '收回',
    }
    let text = map[key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{${k}}`, v)
    return text
  }
  const lease = (over: Partial<PresenceLeaseSnapshot> = {}): PresenceLeaseSnapshot => ({
    leaseId: 'pl-1', kind: 'micro', state: 'active', delegated: false,
    startedAt: Date.now() - 4_000, lastCommandAt: Date.now() - 1_000,
    apps: [{ appId: 'kanban-demo', name: '看板演示' }], focus: { appId: 'kanban-demo', name: '看板演示' },
    ...over,
  })

  it('renders nothing without a lease', async () => {
    const { feed } = presenceWith([])
    render(<StageShell {...props({ presence: feed, t: tZh as never })} />)
    await waitFor(() => { expect(feed.getSnapshot().state).toBe('hidden') })
    expect(screen.queryByText(/AI 正在操作/)).toBeNull()
  })

  it('micro lease shows the acting banner without the particle frame', async () => {
    const { feed } = presenceWith([lease()])
    render(<StageShell {...props({ presence: feed, t: tZh as never })} />)
    expect(await screen.findByText('AI 正在操作 看板演示')).toBeTruthy()
    // Micro never lights the full border (vocabulary grading, §2.3).
    expect(document.querySelectorAll('[aria-hidden="true"] .particle, [class*="particle"]')).toHaveLength(0)
  })

  it('macro lease lights the particle frame and offers the user controls', async () => {
    const { feed, control } = presenceWith([lease({ kind: 'macro', expiresAt: Date.now() + 300_000 })])
    render(<StageShell {...props({ presence: feed, t: tZh as never })} />)
    expect(await screen.findByText(/AI 接管中/)).toBeTruthy()
    expect(document.querySelectorAll('[class*="particle"]')).toHaveLength(16)
    const pause = screen.getByText('暂停 AI')
    pause.click()
    await waitFor(() => { expect(control).toHaveBeenCalledWith('s-1', 'interrupt') })
    expect(screen.getByText('收回')).toBeTruthy()
  })

  it('suspended-user shows the pause wording with resume only', async () => {
    const { feed, control } = presenceWith([lease({ state: 'suspended-user' })])
    render(<StageShell {...props({ presence: feed, t: tZh as never })} />)
    expect(await screen.findByText('已暂停 · AI 让位')).toBeTruthy()
    expect(screen.queryByText('暂停 AI')).toBeNull()
    screen.getByText('继续').click()
    await waitFor(() => { expect(control).toHaveBeenCalledWith('s-1', 'resume') })
  })
})

describe('activity timeline (M5e: global feed + watermark dot)', () => {
  const tZh = (key: string, vars?: Record<string, string>): string => {
    const map: Record<string, string> = { 'activity.menu': '活动', 'activity.empty': '还没有 AI 活动。对已安装应用的操作会出现在这里。', 'activity.outcome.ok': '完成', 'activity.outcome.error': '失败', 'activity.kind.invoke': '调用' }
    let text = map[key] ?? key
    for (const [k, v] of Object.entries(vars ?? {})) text = text.replace(`{${k}}`, v)
    return text
  }

  function remoteWithActivity(rows: import('../src/client/contract.ts').ActivityRow[], seen: number, latest: number): AppStageRemote {
    const base = remoteWith([])
    return {
      ...base,
      presenceSeen: vi.fn(async () => ({ ok: true, value: { ok: true, seen, latest } })),
      presenceTimeline: vi.fn(async () => ({ ok: true, value: { ok: true, rows, latest } })),
      presenceMarkSeen: vi.fn(async (session: never, seq: number) => ({ ok: true, value: { ok: true, seen: seq } })),
    }
  }

  it('shows the blue dot when the feed head is past the watermark', async () => {
    const remote = remoteWithActivity([], 3, 7)
    render(<StageShell {...props({ remote, sessions: session('s-1'), t: tZh as never })} />)
    await waitFor(() => { expect(screen.getByLabelText('4')).toBeTruthy() })
  })

  it('opens the panel with rows newest-first and advances the watermark', async () => {
    const rows: import('../src/client/contract.ts').ActivityRow[] = [
      { ts: Date.now() - 60_000, seq: 4, appId: 'kanban-demo', appName: '看板演示', kind: 'invoke', action: 'createTask', outcome: 'ok', durationMs: 120 },
      { ts: Date.now() - 30_000, seq: 5, appId: 'kanban-demo', appName: '看板演示', kind: 'data.write', outcome: 'error', durationMs: 40 },
    ]
    const remote = remoteWithActivity(rows, 3, 5)
    render(<StageShell {...props({ remote, sessions: session('s-1'), t: tZh as never })} />)
    const trigger = screen.getByRole('button', { name: /活动/ })
    trigger.click()
    expect(await screen.findAllByText('看板演示')).toHaveLength(2)
    // newest first: the data.write error row's outcome appears
    expect(await screen.findByText('失败')).toBeTruthy()
    await waitFor(() => { expect(remote.presenceMarkSeen).toHaveBeenCalledWith('s-1', 5) })
    // Open means read: once the watermark advances, the dot extinguishes even
    // while the panel stays open.
    await waitFor(() => { expect(screen.queryByLabelText(/[1-9]/)).toBeNull() })
  })

  it('renders the empty state with no activity', async () => {
    const remote = remoteWithActivity([], 0, 0)
    render(<StageShell {...props({ remote, sessions: session('s-1'), t: tZh as never })} />)
    screen.getByRole('button', { name: /活动/ }).click()
    expect(await screen.findByText('还没有 AI 活动。对已安装应用的操作会出现在这里。')).toBeTruthy()
    expect(screen.queryByLabelText(/[1-9]/)).toBeNull()
  })
})
