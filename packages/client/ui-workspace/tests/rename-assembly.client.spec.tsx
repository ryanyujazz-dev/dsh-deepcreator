// @vitest-environment jsdom
/**
 * Session-row actions through the real ui-workspace apply and Slot renderer:
 * pinning moves the row into the browser-persisted sibling region, while the
 * native-open verb stays on the official Workspace manager boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import {
  type SessionId,
  type WorkspaceId,
} from '@deepseek-ai/dsh-session/types'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { apply, inject } from '@ryanyujazz/dsh-client-ui-workspace/client'

usePinnedBrowserLanguages('zh-CN')

const SID = 's1' as SessionId

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Runtime with locale and the connected-Host capability ui-workspace consumes. */
async function createRuntime(): Promise<{ runtime: SlotTestRuntime; sessionRemote: object }> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.ctx.provide('connection', { isLoopback: true } as never)
  const sessionAdminRemote = {
    delete: vi.fn(async () => ({ ok: true, value: { ok: true, deletedPath: '/x' } })),
  }
  // Host-open and the canOpenPath capability ride the session remote
  // namespace; the directory picker namespace backs the vendored service.
  const sessionRemote = {
    canOpenWorkspacePath: vi.fn(async () => ({ ok: true as const, value: true })),
    openWorkspacePath: vi.fn(async () => ({ ok: true as const, value: { accepted: true } })),
  }
  const directoryPickerRemote = {
    pick: vi.fn(async () => ({ ok: true as const, value: null })),
    list: vi.fn(async () => ({ ok: true as const, value: { path: '/', entries: [], ancestry: [] } })),
    createDirectory: vi.fn(async () => ({ ok: true as const, value: '/new' })),
  }
  runtime.ctx.provide('remote', {
    'session-admin': sessionAdminRemote,
    session: sessionRemote,
    directoryPicker: directoryPickerRemote,
  } as never)
  runtime.ctx.provide('remote.session-admin', sessionAdminRemote as never)
  runtime.ctx.provide('remote.session', sessionRemote as never)
  runtime.ctx.provide('remote.directoryPicker', directoryPickerRemote as never)
  runtime.slots.installLocale(locale)
  // 0.1.2's ui-workspace apply contributes the root `workspaces` standard
  // hook itself (from the same double list); drop the runtime's built-in
  // source so the apply-owned one is the single provider.
  ;(runtime as unknown as { disposeWorkspaceSource?: () => void }).disposeWorkspaceSource?.()
  return { runtime, sessionRemote }
}

type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

async function assembledBrowser() {
  const { runtime, sessionRemote } = await createRuntime()
  await runtime.sessions.add({
    id: SID,
    summary: { title: '任务标题', displayTitle: '任务标题', cwd: '/w/alpha' },
  })
  await runtime.workspaces.update((draft) => {
    draft.items = [{
      workspaceId: 'w1' as WorkspaceId, title: 'alpha', path: '/w/alpha',
      sessionIds: [SID], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] as never
  })
  await runtime.root.declare(
    { 'sidebar.workspaces': { kind: 'single', scope: 'root' } } as never,
    SidebarFrame as never,
  )
  await runtime.mount({ inject: [...inject], apply })
  const view = runtime.renderRoot()
  return { runtime, view, sessionRemote }
}

describe('session actions through the assembled browser', () => {
  it('moves a pinned session into the independent region and restores it on unpin', async () => {
    const { runtime, view } = await assembledBrowser()
    const row = (await view.findByText('任务标题')).closest('[role="treeitem"]') as HTMLElement
    fireEvent.click(within(row).getByLabelText('会话“任务标题”的操作'))
    expect(view.getAllByRole('menuitem', { hidden: true }).map(item => item.textContent)).toEqual([
      '置顶会话', '分叉会话', '归档会话', '删除会话', '在文件管理器中打开',
    ])
    fireEvent.click(view.getByRole('menuitem', { name: '置顶会话', hidden: true }))

    await view.findByText('置顶')
    expect(view.getAllByText('任务标题')).toHaveLength(1)
    fireEvent.click(view.getByLabelText('会话“任务标题”的操作'))
    fireEvent.click(view.getByRole('menuitem', { name: '取消置顶', hidden: true }))
    await waitFor(() => { expect(view.queryByText('置顶')).toBeNull() })
    expect(view.getAllByText('任务标题')).toHaveLength(1)
    await runtime.dispose()
  })

  it('delegates native folder opening to the official Workspace path opener', async () => {
    const { runtime, view, sessionRemote } = await assembledBrowser()
    // The open verb rides the session remote namespace's path opener.
    fireEvent.click(view.getByLabelText('会话“任务标题”的操作'))
    fireEvent.click(view.getByRole('menuitem', { name: '在文件管理器中打开', hidden: true }))
    await vi.waitFor(() => {
      expect(sessionRemote.openWorkspacePath).toHaveBeenCalledWith({ path: '/w/alpha' })
    })
    await runtime.dispose()
  })
})
