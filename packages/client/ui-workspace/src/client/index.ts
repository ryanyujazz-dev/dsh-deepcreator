/**
 * Workspace plugin, browser half. Two registrations: WorkspaceBrowser fills
 * the sidebar shell's `sidebar.workspaces` hole (the whole browsing region),
 * and WorkspacePicker fills the conversation hero's picker hole
 * (`conversation.hero.workspace` — both hero forms). Both read real Host
 * Workspaces through the global useWorkspaces hook, and each declares its
 * own `single` directory-flow child hole for the composed picker package's
 * client half (see the contract module doc). Export discipline:
 * packages/client/AGENTS.md.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext } from '@ryanyujazz/dsh-client-compat'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) and the
// `session-admin` remote namespace merge (TypertRemoteNamespaceMap).
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-session-admin/remote'
// Type-only: pulls the `session` remote namespace merge (canOpenWorkspacePath).
import type {} from '@deepseek-ai/dsh-api-session-controller/remote'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { WorkspaceBrowserInjected, WorkspacePickerInjected } from './contract/slots.ts'
import { UiWorkspaceService } from './navigation.ts'
import { createWorkspaceViewStore } from './stores.ts'
import { WorkspaceBrowser } from './WorkspaceBrowser.tsx'
import { WorkspacePicker } from './WorkspacePicker.tsx'
import { en, zh, type WorkspaceKey } from './locales.ts'
import { nativeFileManagerFromUserAgent } from './file-manager.ts'

export type {
  DirectoryFlowOwnerProps, DirectoryFlowSlotName, DirectoryPickingHooks, DirectoryPickingInjected,
  WorkspaceBrowserInjected, WorkspaceBrowserProps, WorkspacePickerInjected, WorkspacePickerProps,
} from './contract/slots.ts'
export type { WorkspaceKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace browsing region and pick/create flow copy. */
    workspace: WorkspaceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'workspace'

/**
 * Resolve the reusable blank Session of one Workspace (the Host's own
 * membership rule: blank + cwd match + accounted + not archived) or create
 * it, then select it.
 * @param ctx - client root context.
 * @param workspaceId - target Workspace.
 */
async function connectWorkspace(ctx: ClientContext, workspaceId: WorkspaceId): Promise<void> {
  const workspace = ctx.workspaces.list.getSnapshot().items
    .find(item => item.workspaceId === workspaceId)
  if (workspace === undefined) throw new Error(`unknown workspace ${workspaceId}`)
  const archived = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds)
  const sessions = ctx.sessions.list.getSnapshot()
  for (const id of sessions.ids) {
    const summary = sessions.byId[id]
    if (summary !== undefined && summary.blank && summary.cwd === workspace.path
      && workspace.sessionIds.includes(summary.id) && !archived.has(summary.id)) {
      ctx.sessions.open(summary.id)
      return
    }
  }
  ctx.sessions.open(await ctx.sessions.create({ workspaceId }))
}

/**
 * Start a New Session in a Workspace: reuse-or-create its blank session and
 * open it; without an explicit workspace, inherit the current Session
 * Workspace, then the most recent Workspace, or clear into the New Session
 * view.
 * @param ctx - client root context.
 * @param workspaceId - explicit target Workspace.
 */
function startSession(ctx: ClientContext, workspaceId?: WorkspaceId): void {
  const workspaces = ctx.workspaces.list.getSnapshot()
  const sessions = ctx.sessions.list.getSnapshot()
  const current = sessions.current
  const currentWorkspaceId = current === undefined
    ? undefined
    : workspaces.items.find(item => item.sessionIds.includes(current))?.workspaceId
  const recent = workspaces.phase === 'ready' && sessions.phase === 'ready'
    ? recentWorkspace(workspaces.items, sessions.byId)
    : undefined
  const target = workspaceId ?? currentWorkspaceId ?? recent
  if (target === undefined) {
    ctx.sessions.clear()
    return
  }
  connectWorkspace(ctx, target).catch((reason: unknown) => {
    console.warn('new session failed:', reason)
  })
}

/** Stable tie-breaking follows Host Workspace order. */
function recentWorkspace(
  workspaces: readonly WorkspaceView[],
  byId: SessionListState['byId'],
): WorkspaceId | undefined {
  let selected: WorkspaceId | undefined
  let selectedTime = Number.NEGATIVE_INFINITY
  for (const workspace of workspaces) {
    let latest = Number.NEGATIVE_INFINITY
    for (const sessionId of workspace.sessionIds) {
      const session = byId[sessionId]
      if (session !== undefined) latest = Math.max(latest, session.updatedAt)
    }
    if (latest === Number.NEGATIVE_INFINITY) latest = Date.parse(workspace.createdAt)
    if (selected === undefined || latest > selectedTime) {
      selected = workspace.workspaceId
      selectedTime = latest
    }
  }
  return selected
}

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * the ui-sidebar / ui-conversation applies, whose activation order relative
 * to this one is NOT constrained: dsh.client.inject edges are informational
 * (loading/prefetch metadata, never apply sequencing) and neither owner
 * provides a waitable service. apply therefore depends on each slot
 * declaration through `slots.inject()` instead of assuming order.
 */
export const inject = ['slots', 'sessions', 'workspaces', 'locale', 'connection', 'remote', 'remote.session', 'remote.session-admin', 'remote.directoryPicker']

/**
 * Register the browser and picker once their slot declarations are on the
 * ledger. Inject factories return plain callbacks; data reads use the
 * framework's global hooks.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  // The cross-plugin `uiWorkspace` navigation face (sidebar New Session,
  // agent-preset navigation, directory picking): the vendored official
  // UiWorkspaceService registers itself as `uiWorkspace` and owns the
  // initial-selection watcher and the directory-picker Remote wiring.
  new UiWorkspaceService(ctx, ctx.remote.directoryPicker, ctx.workspaces, ctx.sessions)

  // The root standard-kit hook the workspace components bind through the
  // global useWorkspaces seat (WorkspaceBrowser/Picker, ConversationRoot).
  ctx.slots.provideRoot({ hooks: { workspaces: ctx.workspaces.list } })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace: dictionaries')

  const searchSessions: WorkspaceBrowserInjected['searchSessions'] = async (query, signal) => {
    const result = await ctx.sessions.search(query, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }

  // Stable per-surface occupancy sources (the renderer's hook cache keys by
  // source identity): true while the surface's directory-flow hole is filled.
  const flowSource = (hole: 'sidebar.workspaces.directoryFlow' | 'conversation.hero.workspace.directoryFlow'): HostObservable<boolean> => ({
    getSnapshot: () => ctx.slots.entries(hole).length > 0,
    subscribe: listener => ctx.slots.subscribe(hole, listener),
  })
  const browserFlowSource = flowSource('sidebar.workspaces.directoryFlow')
  const pickerFlowSource = flowSource('conversation.hero.workspace.directoryFlow')
  const connection = ctx.get('connection') as ConnectionHandle
  // The `session.canOpenWorkspacePath` verb is request-scoped: the source
  // caches the latest answer and re-queries when the carrier resets.
  let canOpenPath = false
  const canOpenPathListeners = new Set<() => void>()
  const canOpenPathSource: HostObservable<boolean> = {
    getSnapshot: () => canOpenPath,
    subscribe: (listener) => {
      canOpenPathListeners.add(listener)
      return () => { canOpenPathListeners.delete(listener) }
    },
  }
  const refreshCanOpenPath = (): void => {
    void ctx.remote.session.canOpenWorkspacePath().then((result) => {
      const next = result.ok && result.value
      if (next !== canOpenPath) {
        canOpenPath = next
        for (const listener of canOpenPathListeners) listener()
      }
    }, () => {
      // Carrier down: keep the last known capability until the reset re-query.
    })
  }
  refreshCanOpenPath()
  ctx.effect(() => ctx.on('connection/reset', refreshCanOpenPath), 'ui-workspace: canOpenPath feed')
  const fileManager = connection.isLoopback
    ? nativeFileManagerFromUserAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent)
    : 'generic'
  // Cordis returns a fresh traced Proxy for every associated namespace read.
  // Capture this namespace once so renders never re-read the association.
  const sessionAdmin = (ctx.get('remote') as TypertClientRemote)['session-admin']
  const browserInjected = (): WorkspaceBrowserInjected => ({
    canManageWorkspaces: connection.isLoopback,
    canPermanentlyDelete: connection.isLoopback,
    // Explicit group actions keep their target; unscoped New Session inherits
    // the current Session Workspace before the recent-Workspace fallback.
    startSession: (workspaceId) => { startSession(ctx, workspaceId) },
    open: (sessionId) => { ctx.sessions.open(sessionId) },
    openWorkspaceLocation: (path) => {
      void ctx.remote.session.openWorkspacePath({ path }).then((result) => {
        if (!result.ok) console.warn('workspace path open rejected:', result.error.message)
      }, (reason: unknown) => {
        console.warn('workspace path open rejected:', reason)
      })
    },
    fileManager,
    searchSessions,
    searchResultLimit: ctx.sessions.searchResultLimit,
    renameSession: async (sessionId, title) => {
      // Row → session-face hop: rename is a per-session verb (ISession), not
      // a list-service verb; the binding resolves any listed session.
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`unknown session "${sessionId}"`)
      const result = await session.rename(title)
      if (!result.ok) throw new Error(result.error.message)
    },
    forkSession: (sessionId) => {
      ctx.sessions.fork({ sessionId, increaseTitle: true })
        .then((childId) => { ctx.sessions.open(childId) })
        .catch(() => {
          // Fork or child-rename failure keeps the current selection.
        })
    },
    renameWorkspace: async (workspaceId, title) => { await ctx.workspaces.rename(workspaceId, title) },
    deleteWorkspace: async (workspaceId) => { await ctx.workspaces.delete(workspaceId) },
    insertWorkspaceBefore: async (workspaceId, beforeWorkspaceId) => {
      await ctx.workspaces.insertBefore(workspaceId, beforeWorkspaceId)
    },
    archiveSession: async (sessionId) => { await ctx.workspaces.archiveSession(sessionId) },
    deleteSession: async (sessionId) => {
      const wire = await sessionAdmin.delete(sessionId)
      if (!wire.ok) throw new Error(wire.error.message)
      if (!wire.value.ok) throw new Error(wire.value.message)
      // The Host removed a cold persisted log; re-pull the authoritative list
      // through the sessions service's documented refresh boundary so the row
      // drops.
      await ctx.sessions.refresh()
    },
    insertSessionBefore: async (workspaceId, sessionId, beforeSessionId) => {
      await ctx.workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    },
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: browserFlowSource, canOpenPath: canOpenPathSource },
  })
  const pickerInjected = (): WorkspacePickerInjected => ({
    createWorkspace: input => ctx.workspaces.create(input),
    hooks: { directoryFlow: pickerFlowSource },
  })
  // Each registration declares its directory-flow child in the same call;
  // slot injection follows both the owner and declaration HMR lifetimes.
  ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register(
    {
      name: 'sidebar.workspaces',
      children: { 'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' } },
      store: createWorkspaceViewStore(),
      inject: browserInjected,
      locale: NS,
    },
    WorkspaceBrowser,
  ))
  ctx.slots.inject('conversation.hero.workspace', () => ctx.slots.register(
    {
      name: 'conversation.hero.workspace',
      children: { 'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' } },
      inject: pickerInjected,
      locale: NS,
    },
    WorkspacePicker,
  ))
}
