// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReviewCacheSnapshot } from '../src/client/review-cache.ts'
import { TurnChangeCard } from '../src/client/TurnChangeCard.tsx'

const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-tools/src/client/TurnChangeCard.module.css'), 'utf8')
const sharedStylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-primitives/src/ConversationFileCard.module.css'), 'utf8')

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
    subscribeHistory: () => () => undefined,
    getHistorySnapshot: () => snapshot.history,
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

  it('expands its file list, shows line counts, focuses a selected file, and confirms undo', async () => {
    const input = props({
      status: null, checks: null, scope: 'uncommitted', entries: {}, error: null,
      history: { ok: true, repositoryRoot: '/workspace', turns: [{
        turn: 7, totalFiles: 2, remainingFiles: 1, additions: 5, deletions: 3, state: 'mixed', undoable: true,
        files: [
          { path: 'src/a.ts', state: 'pending', additions: 4, deletions: 1 },
          { path: 'src/b.ts', state: 'committed', additions: 1, deletions: 2 },
        ],
      }] },
    })
    const view = render(<TurnChangeCard {...input} />)
    const leadingIcon = view.container.querySelector('[data-conversation-file-card-leading-icon]')
    expect(leadingIcon?.querySelectorAll('svg')).toHaveLength(2)
    fireEvent.click(view.getByText('变更 2 个文件'))
    expect(input.workbench.present).not.toHaveBeenCalled()
    expect(view.getByText('src/a.ts')).not.toBeNull()
    expect(view.getByText('src/b.ts')).not.toBeNull()
    expect(view.getByText('+5')).not.toBeNull()
    expect(view.getByText('src/a.ts').nextElementSibling?.textContent).toBe('+4-1')
    fireEvent.click(view.getByText('src/a.ts'))
    expect(input.workbench.present).toHaveBeenCalledWith(expect.objectContaining({
      typeId: 'review', target: 'src/a.ts', parameters: { scope: 'turn', turn: '7', expand: 'all' }, reveal: true,
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
    expect(view.queryByText('+0')).toBeNull()
    expect(view.queryByText('-0')).toBeNull()
    expect((view.getByRole('button', { name: '审查' }) as HTMLButtonElement).disabled).toBe(true)
    expect((view.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('leaves binary outputs to the Artifact card instead of duplicating them as changes', () => {
    const binaryOnly = props({
      status: null, checks: null, scope: 'uncommitted', entries: {}, error: null,
      history: { ok: true, repositoryRoot: '/workspace', turns: [{
        turn: 7, totalFiles: 2, remainingFiles: 2, state: 'active', undoable: true,
        files: [
          // The extension fallback covers the short settling window before the
          // Host has replaced its provisional text classification.
          { path: 'output/chart.PNG', state: 'pending', presentation: 'text' },
          { path: 'output/report.pdf', state: 'pending', presentation: 'binary', lineStatsState: 'not-applicable' },
        ],
      }] },
    })
    const view = render(<TurnChangeCard {...binaryOnly} />)
    expect(view.container.innerHTML).toBe('')

    const mixed = props({
      status: null, checks: null, scope: 'uncommitted', entries: {}, error: null,
      history: { ok: true, repositoryRoot: '/workspace', turns: [{
        turn: 7, totalFiles: 2, remainingFiles: 2, state: 'active', undoable: true,
        files: [
          { path: 'src/index.ts', state: 'pending', additions: 3, deletions: 1, presentation: 'text', lineStatsState: 'available' },
          { path: 'output/chart.png', state: 'pending', presentation: 'text' },
        ],
      }] },
    })
    const mixedView = render(<TurnChangeCard {...mixed} />)
    expect(mixedView.getByText('变更 1 个文件')).toBeTruthy()
    fireEvent.click(mixedView.getByText('变更 1 个文件'))
    expect(mixedView.getByText('src/index.ts')).toBeTruthy()
    expect(mixedView.queryByText('output/chart.png')).toBeNull()
  })

  it('keeps the card and actions on the shared panel interaction tokens', () => {
    expect(sharedStylesheet).toContain('background: var(--dsw-specific-sidebar-fill);')
    expect(sharedStylesheet).toMatch(/\.card\s*\{[^}]*border: 1px solid var\(--dsw-alias-border-l1\);[^}]*border-radius: 12px;[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.actions\s*\{[^}]*gap: 4px;[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.action\s*\{[^}]*height: 28px;[^}]*border-radius: 6px;[^}]*background: transparent;[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.action:not\(:disabled\):hover\s*\{[^}]*background: var\(--dsw-alias-interactive-bg-hover\);[^}]*\}/s)
    expect(sharedStylesheet).not.toContain('.action + .action')
    expect(sharedStylesheet).toContain('.header:has(.summary:not(:disabled):hover)')
    expect(sharedStylesheet).not.toContain('.summary:not(:disabled):hover { background:')
    expect(sharedStylesheet).toContain('.summary:not(:disabled):hover .primaryIcon')
    expect(sharedStylesheet).toContain('.summary:not(:disabled):hover .chevronIcon')
    expect(sharedStylesheet).toMatch(/\.leadingIcon\s*\{[^}]*height: 16px;[^}]*transform: translateY\(-1px\);[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.label\s*\{[^}]*line-height: 16px;[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.file\s*\{[^}]*grid-template-columns: 16px minmax\(0, 1fr\) auto;[^}]*column-gap: 7px;[^}]*padding: 0 11px;[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.fileIcon\s*\{[^}]*width: 16px;[^}]*place-items: center;[^}]*transform: translateY\(-1px\);[^}]*\}/s)
    expect(sharedStylesheet).toMatch(/\.filePath\s*\{[^}]*line-height: 16px;[^}]*\}/s)
    expect(stylesheet).toMatch(/\.diffCounts\s*\{[^}]*align-items: baseline;[^}]*height: 16px;[^}]*line-height: 16px;[^}]*\}/s)
  })
})
