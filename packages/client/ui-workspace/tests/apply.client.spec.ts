import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  SlotRegistry,
} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@ryanyujazz/dsh-client-ui-workspace/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from '@ryanyujazz/dsh-client-ui-workspace/client'
import { WorkspaceBrowser } from '../src/client/WorkspaceBrowser.tsx'
import { WorkspacePicker } from '../src/client/WorkspacePicker.tsx'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // 0.1.2: the UiWorkspaceService watches both controller list stores
  // (initial-selection policy), and New Session reuse resolves the reusable
  // blank Session of the target Workspace through them.
  const workspacesList = createSnapshotStore<{
    items: {
      workspaceId: WorkspaceId; path: string; title: string; sessionIds: SessionId[];
      createdAt: string; updatedAt: string;
    }[]
    archivedSessionIds: SessionId[]
    phase: 'ready'
  }>({
    items: [{
      workspaceId: 'ws' as never, path: '/projects/ws', title: 'WS',
      sessionIds: ['session' as never], createdAt: '0', updatedAt: '0',
    }],
    archivedSessionIds: [], phase: 'ready',
  })
  const sessionsList = createSnapshotStore<{
    ids: SessionId[]
    byId: Record<string, { id: SessionId; blank: boolean; cwd: string; updatedAt: number }>
    current: SessionId | undefined
    phase: 'ready'
  }>({
    ids: ['session' as never],
    byId: { session: { id: 'session' as never, blank: true, cwd: '/projects/ws', updatedAt: 1 } },
    current: 'session' as never,
    phase: 'ready',
  })
  const create = vi.fn(async (input: { name: string } | { path: string }) => ({
    workspaceId: 'ws-new' as never,
    path: 'name' in input ? `/projects/${input.name}` : input.path,
    title: 'new', sessionIds: [], createdAt: '0', updatedAt: '0',
  }))
  const rename = vi.fn(async () => ({}))
  const insertSessionBefore = vi.fn(async () => ({}))
  const open = vi.fn()
  const clear = vi.fn()
  const refresh = vi.fn(async () => {})
  const search = vi.fn(async () => ({
    ok: true as const,
    value: { items: [{ sessionId: 'session' as never, snippet: 'match' }], hasMore: false },
  }))
  const createSession = vi.fn(async () => 'created-session' as never)
  const renameSession = vi.fn(async (title: string) => ({ ok: true, value: { title, seq: 1 } }))
  const binding = vi.fn(() => ({ session: { rename: renameSession } }))
  const fork = vi.fn(async () => 'forked' as never)
  ctx.provide('workspaces', {
    list: workspacesList, create, rename, insertSessionBefore,
  } as never)
  ctx.provide('sessions', {
    list: sessionsList, open, clear, refresh, search, searchResultLimit: 20, binding, fork, create: createSession,
  } as never)
  ctx.provide('connection', { isLoopback: true } as never)
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const sessionAdminRemote = {
    delete: vi.fn(async () => ({ ok: true, value: { ok: true, deletedPath: '/x' } })),
  }
  // 0.1.2: host-open and the canOpenPath capability ride the session remote
  // namespace; the directory picker rides its own namespace (the vendored
  // UiWorkspaceService consumes it for the directory UI).
  const sessionRemote = {
    canOpenWorkspacePath: vi.fn(async () => ({ ok: true as const, value: true })),
    openWorkspacePath: vi.fn(async () => ({ ok: true as const, value: { accepted: true } })),
  }
  const directoryPickerRemote = {
    pick: vi.fn(async () => ({ ok: true as const, value: null })),
    list: vi.fn(async () => ({ ok: true as const, value: { path: '/', entries: [], ancestry: [] } })),
    createDirectory: vi.fn(async () => ({ ok: true as const, value: '/new' })),
  }
  // The traced namespace object and the Cordis store entry both resolve:
  // plugins associate `remote.<ns>` through the store, while apply reads the
  // namespaces off the mounted remote object.
  ctx.provide('remote', {
    'session-admin': sessionAdminRemote,
    session: sessionRemote,
    directoryPicker: directoryPickerRemote,
  } as never)
  ctx.provide('remote.session-admin', sessionAdminRemote as never)
  ctx.provide('remote.session', sessionRemote as never)
  ctx.provide('remote.directoryPicker', directoryPickerRemote as never)
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, create, rename,
    insertSessionBefore, open, clear, refresh, search, createSession, renameSession, binding, fork,
    sessionAdminRemote, sessionRemote, directoryPickerRemote,
  }
}

type HoleName = 'sidebar.workspaces' | 'conversation.hero.workspace' | 'conversation.empty.workspace'

/** Declare any subset of the holes with a single root registration ('root' is a single slot). */
function declare(slots: SlotRegistry, ...names: HoleName[]): () => void {
  const children = Object.fromEntries(names.map(name => [name, { kind: 'single', scope: 'root' }]))
  return slots.register({ name: 'root', children } as never, () => null)
}

describe('ui-workspace apply', () => {
  it('declares the services it drives', () => {
    expect(inject).toEqual(['slots', 'sessions', 'workspaces', 'locale', 'connection', 'remote', 'remote.session', 'remote.session-admin', 'remote.directoryPicker'])
  })

  it('registers browser and pickers for declarations arriving before or after apply', async () => {
    const before = await bench()
    declare(before.slots, 'sidebar.workspaces')
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries('sidebar.workspaces')[0]!.component).toBe(WorkspaceBrowser)
    // Copy rides the standard locale seat: the entry declares the namespace
    // and apply registered both dictionaries.
    expect(before.slots.entries('sidebar.workspaces')[0]!.locale).toBe('workspace')
    expect(before.locale.bind('workspace')('session.new')).toBe('新会话')

    const after = await bench()
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    declare(after.slots, 'conversation.hero.workspace', 'conversation.empty.workspace')
    await Promise.resolve()
    expect(after.slots.entries('conversation.hero.workspace')[0]!.component).toBe(WorkspacePicker)
    // expect(after.slots.entries('conversation.empty.workspace')[0]!.component).toBe(WorkspacePicker)
  })

  it('routes browser actions and picker creation to the services', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
    await b.ctx.plugin({ inject: [...inject], apply }).await()

    const browser = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => WorkspaceBrowserInjected)()
    // Both New Session arms ride the shared reuse-or-create policy: the
    // explicit workspace targets it directly; the unscoped call inherits the
    // current Session's Workspace. Both resolve the Workspace's reusable
    // blank Session and open it.
    browser.startSession('ws' as never)
    browser.startSession()
    await vi.waitFor(() => {
      expect(b.open).toHaveBeenLastCalledWith('session')
    })
    expect(b.open).toHaveBeenCalledTimes(2)
    browser.open('session' as never)
    expect(b.open).toHaveBeenCalledWith('session')
    // Host-open rides the session remote namespace on loopback builds.
    browser.openWorkspaceLocation('/projects/demo')
    await vi.waitFor(() => {
      expect(b.sessionRemote.openWorkspacePath).toHaveBeenCalledWith({ path: '/projects/demo' })
    })
    // The capability feed queries the session remote (request-scoped verb).
    await vi.waitFor(() => {
      expect(browser.hooks.canOpenPath.getSnapshot()).toBe(true)
    })
    const signal = new AbortController().signal
    await expect(browser.searchSessions('match', signal)).resolves.toEqual({
      items: [{ sessionId: 'session', snippet: 'match' }],
      hasMore: false,
    })
    expect(b.search).toHaveBeenCalledWith('match', signal)
    expect(browser.searchResultLimit).toBe(20)
    await browser.renameSession('session' as never, 'renamed session')
    expect(b.binding).toHaveBeenCalledWith('session')
    expect(b.renameSession).toHaveBeenCalledWith('renamed session')
    browser.forkSession('session' as never)
    await vi.waitFor(() => {
      expect(b.open).toHaveBeenCalledWith('forked')
    })
    expect(b.fork).toHaveBeenCalledWith({ sessionId: 'session', increaseTitle: true })
    await browser.renameWorkspace('ws' as never, 'renamed')
    expect(b.rename).toHaveBeenCalledWith('ws', 'renamed')
    await browser.insertSessionBefore('ws' as never, 's1' as never, 's2' as never)
    expect(b.insertSessionBefore).toHaveBeenCalledWith('ws', 's1', 's2')
    await browser.deleteSession('session-11111111-2222-4333-8444-555555555555' as never)
    expect(b.sessionAdminRemote.delete).toHaveBeenCalledWith('session-11111111-2222-4333-8444-555555555555')
    expect(b.refresh).toHaveBeenCalledTimes(1)
    await browser.createWorkspace({ path: '/tmp/browser-project' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/browser-project' })

    const picker = (b.slots.entries('conversation.hero.workspace')[0]!.inject as () => WorkspacePickerInjected)()
    await picker.createWorkspace({ path: '/tmp/project' })
    expect(b.create).toHaveBeenCalledWith({ path: '/tmp/project' })
  })

  it('declares the two directory-flow holes and reports their occupancy per surface', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // Registration declared the child holes (declaration = render authorization).
    expect(b.slots.spec('sidebar.workspaces.directoryFlow')).toMatchObject({ kind: 'single' })
    expect(b.slots.spec('conversation.hero.workspace.directoryFlow')).toMatchObject({ kind: 'single' })

    const browser = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => WorkspaceBrowserInjected)()
    const picker = (b.slots.entries('conversation.hero.workspace')[0]!.inject as () => WorkspacePickerInjected)()
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(false)
    expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
    // A flow occupant flips exactly its own surface, and the source notifies.
    const notified = vi.fn()
    const unsubscribe = browser.hooks.directoryFlow.subscribe(notified)
    const dispose = b.slots.register({ name: 'sidebar.workspaces.directoryFlow' } as never, () => null)
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(true)
    expect(picker.hooks.directoryFlow.getSnapshot()).toBe(false)
    await Promise.resolve()
    expect(notified).toHaveBeenCalled()
    dispose()
    expect(browser.hooks.directoryFlow.getSnapshot()).toBe(false)
    unsubscribe()
  })

  it('rejects the browser search callback on a runtime business error', async () => {
    const b = await bench()
    b.search.mockImplementationOnce(async () => ({
      ok: false,
      error: { code: 'internal', message: 'index unavailable', details: {} },
    }) as never)
    declare(b.slots, 'sidebar.workspaces')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const browser = (b.slots.entries('sidebar.workspaces')[0]!.inject as () => WorkspaceBrowserInjected)()
    await expect(browser.searchSessions('needle', new AbortController().signal))
      .rejects.toThrow('index unavailable')
  })

  it('unregisters every entry on teardown', async () => {
    const b = await bench()
    declare(b.slots, 'sidebar.workspaces', 'conversation.hero.workspace', 'conversation.empty.workspace')
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.workspaces')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.workspace')).toHaveLength(0)
    // expect(b.slots.entries('conversation.empty.workspace')).toHaveLength(0)
  })
})
