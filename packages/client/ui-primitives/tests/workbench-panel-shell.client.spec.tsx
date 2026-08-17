// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WorkbenchPanelIconButton, WorkbenchPanelShell,
} from '../src/WorkbenchPanelShell.tsx'

afterEach(cleanup)

function renderShell() {
  const onShowHome = vi.fn()
  const onActivateTab = vi.fn()
  const onCloseTab = vi.fn()
  const onHide = vi.fn()
  const onFocus = vi.fn()
  return {
    view: render(
      <WorkbenchPanelShell
        typeId="terminal"
        label="终端"
        route="instance"
        tabs={['shell-1', 'shell-2']}
        activeInstanceId="shell-2"
        supportsHome
        focused={false}
        backLabel="返回终端"
        focusLabel="展开面板"
        restoreLabel="收起面板"
        closeGroupLabel="隐藏终端面板"
        closeTabLabel={tab => `关闭${tab}`}
        onShowHome={onShowHome}
        onActivateTab={onActivateTab}
        onCloseTab={onCloseTab}
        onHide={onHide}
        onFocus={onFocus}
        onRestore={vi.fn()}
        leftActions={<WorkbenchPanelIconButton label="新建"><span>+</span></WorkbenchPanelIconButton>}
        rightActions={<WorkbenchPanelIconButton label="刷新"><span>↻</span></WorkbenchPanelIconButton>}
      >
        <div>Panel content</div>
      </WorkbenchPanelShell>,
    ),
    onShowHome,
    onActivateTab,
    onCloseTab,
    onHide,
    onFocus,
  }
}

describe('shared Workbench PanelShell', () => {
  it('places the tab plus left and every other action right', async () => {
    const { view } = renderShell()
    const create = await view.findByRole('button', { name: '新建' })
    const refresh = await view.findByRole('button', { name: '刷新' })
    const firstTab = view.getByRole('tab', { name: 'shell-1' })
    const latestTab = view.getByRole('tab', { name: 'shell-2' })
    const tablist = view.getByRole('tablist')
    const back = view.getByRole('button', { name: '返回终端' })

    expect(firstTab.compareDocumentPosition(latestTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(latestTab.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(tablist).queryByRole('button', { name: '新建' })).toBeNull()
    expect(create.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(view.queryByText('终端')).toBeNull()
    expect(refresh.compareDocumentPosition(back) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(view.getByText('Panel content')).toBeTruthy()
  })

  it('keeps common navigation, tabs, focus and visibility behavior in the shell', () => {
    const input = renderShell()
    fireEvent.click(input.view.getByRole('button', { name: '返回终端' }))
    fireEvent.click(input.view.getByRole('tab', { name: 'shell-1' }))
    fireEvent.click(input.view.getByRole('button', { name: '关闭shell-1' }))
    fireEvent.click(input.view.getByRole('button', { name: '展开面板' }))
    fireEvent.click(input.view.getByRole('button', { name: '隐藏终端面板' }))
    expect(input.onShowHome).toHaveBeenCalledOnce()
    expect(input.onActivateTab).toHaveBeenCalledWith('shell-1')
    expect(input.onCloseTab).toHaveBeenCalledWith('shell-1')
    expect(input.onFocus).toHaveBeenCalledOnce()
    expect(input.onHide).toHaveBeenCalledOnce()
  })
})
