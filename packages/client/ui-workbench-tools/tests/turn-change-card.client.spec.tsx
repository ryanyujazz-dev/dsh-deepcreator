// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewCacheSnapshot } from '../src/client/review-cache.ts'
import { TurnChangeCard } from '../src/client/TurnChangeCard.tsx'

afterEach(cleanup)

const t = (key: string, params?: Record<string, unknown>) => {
  const copy: Record<string, string> = {
    'turnCard.files': '变更 {count} 个文件', 'turnCard.remaining': '剩余 {count} 个',
    'turnCard.undo': '撤销', 'turnCard.review': '审查', 'turnCard.undoUnavailable': '不可撤销',
    'turnCard.undoTitle': '撤销本轮变更？', 'turnCard.undoDescription': '撤销 {count} 个文件',
    'turnCard.cancel': '取消', 'turnCard.confirmUndo': '确认撤销', 'turnCard.undoing': '正在撤销',
    'turnCard.state.committed': '已提交', 'turnCard.state.reverted': '已撤销',
    'turnCard.state.mixed': '已解决', 'turnCard.state.active': '待处理',
  }
  return (copy[key] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? ''))
}

function props(snapshot: ReviewCacheSnapshot) {
  const controller = {
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot,
    undoTurn: vi.fn().mockResolvedValue({ ok: true, repositoryRoot: '/workspace', turn: 7, revertedFiles: ['src/a.ts'] }),
  }
  const workbench = { present: vi.fn() }
  return {
    turn: { turn: 7, status: 'closed', start: undefined, end: undefined, steps: [], data: { get: () => undefined } },
    seq: 10, sessionId: 'session-1', openFile: vi.fn(), controller, workbench, t,
  } as never
}

describe('TurnChangeCard', () => {
  it('renders nothing for zero-change turns that have no history record', () => {
    const input = props({ status: null, checks: null, history: { ok: true, repositoryRoot: '/workspace', turns: [] }, scope: 'uncommitted', entries: {}, error: null })
    const view = render(<TurnChangeCard {...input} />)
    expect(view.container.innerHTML).toBe('')
  })

  it('opens the exact turn/file and confirms undo for the newest active turn', async () => {
    const input = props({
      status: null, checks: null, scope: 'uncommitted', entries: {}, error: null,
      history: { ok: true, repositoryRoot: '/workspace', turns: [{
        turn: 7, totalFiles: 2, remainingFiles: 1, state: 'mixed', undoable: true,
        files: [{ path: 'src/a.ts', state: 'pending' }, { path: 'src/b.ts', state: 'committed' }],
      }] },
    })
    const view = render(<TurnChangeCard {...input} />)
    fireEvent.click(view.getByText('变更 2 个文件'))
    expect(input.workbench.present).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'review', target: 'src/a.ts', parameters: { turn: '7' }, reveal: true,
    }))
    fireEvent.click(view.getByRole('button', { name: '撤销' }))
    expect(view.getByRole('dialog', { name: '撤销本轮变更？' })).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: '确认撤销' }))
    await waitFor(() => { expect(input.controller.undoTurn).toHaveBeenCalledWith(7) })
  })

  it('grays and disables a fully committed turn', () => {
    const input = props({
      status: null, checks: null, scope: 'uncommitted', entries: {}, error: null,
      history: { ok: true, repositoryRoot: '/workspace', turns: [{
        turn: 7, totalFiles: 1, remainingFiles: 0, state: 'committed', undoable: false,
        files: [{ path: 'src/a.ts', state: 'committed' }],
      }] },
    })
    const view = render(<TurnChangeCard {...input} />)
    expect(view.getByText('已提交')).not.toBeNull()
    expect((view.getByRole('button', { name: '审查' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
