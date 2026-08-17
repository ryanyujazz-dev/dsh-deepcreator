// @vitest-environment jsdom
/**
 * Session-row actions through the real ui-workspace apply and Slot renderer:
 * pinning moves the row into the browser-persisted sibling region, while the
 * native-open verb stays on the official Workspace manager boundary.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotTestRuntime, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { apply, inject } from '@ryanyujazz/dsh-client-ui-workspace/client'

usePinnedBrowserLanguages('zh-CN')

const SID = 's1' as SessionId

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

/** Runtime with locale and the connected-Host capability ui-workspace consumes. */
async function createRuntime(): Promise<SlotTestRuntime> {
  const runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.provide('locale', locale)
  runtime.provide('connection', {
    isLoopback: true,
    hostDescription: {
      getSnapshot: () => ({ canOpenPath: true }),
      subscribe: () => () => {},
    },
  } as never)
  runtime.slots.installLocale(locale)
  return runtime
}

type FrameProps = PropsRenderSlots<'sidebar.workspaces'>
function SidebarFrame({ renderSlot }: FrameProps) {
  return <>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}</>
}

async function assembledBrowser() {
  const runtime = await createRuntime()
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
  return { runtime, view }
}

describe('session actions through the assembled browser', () => {
  it('moves a pinned session into the independent region and restores it on unpin', async () => {
    const { runtime, view } = await assembledBrowser()
    const row = (await view.findByText('任务标题')).closest('[role="treeitem"]') as HTMLElement
    fireEvent.click(within(row).getByLabelText('会话“任务标题”的操作'))
    expect(view.getAllByRole('menuitem', { hidden: true }).map(item => item.textContent)).toEqual([
      '置顶会话', '分叉会话', '归档会话', '在文件管理器中打开',
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
    const { runtime, view } = await assembledBrowser()
    const openPath = vi.spyOn(runtime.workspaces, 'openPath').mockResolvedValue(undefined)
    fireEvent.click(view.getByLabelText('会话“任务标题”的操作'))
    fireEvent.click(view.getByRole('menuitem', { name: '在文件管理器中打开', hidden: true }))
    expect(openPath).toHaveBeenCalledWith('/w/alpha')
    await runtime.dispose()
  })
})
