// @vitest-environment jsdom
// The diff render intent on the web side: the pure diffCardModel derivation
// over callView/resultView, and both conversation render sites that consume it
// — the chat tool row's expanded body (GenericToolCard / FileMutationRow) and
// the details panel's Output section.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSnapshot, RunningToolCall, SessionId, SessionListState, ToolResultNode, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-api-remotes/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { computeHunkDiffs } from '@deepseek-ai/dsh-tool-fs'
import { zh as commonZh } from '@ryanyujazz/dsh-client-locale/src/locales/zh.ts'
import { diffCardModel } from '../src/client/tool/models/diff-card-model.ts'
import { createChatStore } from '@ryanyujazz/dsh-client-ui-conversation/src/client/stores.ts'
import { GenericToolCard, type GenericToolCardProps } from '../src/client/tool/toolviews/GenericToolCard.tsx'
import { FileMutationRow, fileMutationToolview } from '../src/client/tool/toolviews/file-mutation-row.tsx'
import { toolChatSnapshot } from './tool-details-render.client.tsx'
import { zh } from '@ryanyujazz/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

/** FileMutationRow's full prop shape (ToolRow runtime share + conversation locale seat). */
type FileMutationRowProps = Parameters<typeof FileMutationRow>[0]

const SID = 's1' as SessionId

const t = makeTranslate(zh, commonZh)

function hasDiffRowText(container: HTMLElement, text: string): boolean {
  return [...container.querySelectorAll('[data-diff-row]')].some(row => row.textContent?.includes(text) === true)
}

const ARGS = '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}'

/** The edit tool's own call view (a call-time diff derived from the arguments). */
const callDiff = (over?: Partial<Extract<ToolCallView, { card: 'diff' }>>): ToolCallView => ({
  card: 'diff', title: 'Edit notes/demo.txt',
  diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }], ...over,
})

/** The edit tool's own result view (the applied hunk diff). */
const resultDiff = (over?: Partial<Extract<ToolResultView, { card: 'diff' }>>): ToolResultView => ({
  card: 'diff', title: 'Edit notes/demo.txt',
  diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }], ...over,
})

const running = (over?: Partial<RunningToolCall>): RunningToolCall => ({
  callId: 'c1', name: 'edit', argsRaw: ARGS,
  turn: 1, step: 1, time: 1_000, callView: callDiff(), subCalls: [], ...over,
})

const settled = (over?: Partial<ToolResultNode>): ToolResultNode => ({
  kind: 'tool-result', seq: 10, time: 2_000, callId: 'c1',
  call: { name: 'edit', argsRaw: ARGS },
  callTime: 1_000,
  content: [{ type: 'text', text: 'The file notes/demo.txt has been updated successfully.' }], isError: false,
  callView: callDiff(), resultView: resultDiff(), subCalls: [], ...over,
})

describe('diffCardModel', () => {
  it('the pinned official producer emits absolute hunk starts and the client preserves them', () => {
    const before = Array.from({ length: 12 }, (_value, index) => `line ${index + 1}`).join('\n')
    const after = before.replace('line 9', 'line changed')
    const diffs = computeHunkDiffs('demo.ts', before, after)
    expect(diffs).toMatchObject([{ oldStart: 6, newStart: 6 }])
    const wire = resultDiff({ diffs })
    expect(diffCardModel(settled({ resultView: wire }))?.card.diffs).toMatchObject([{ oldStart: 6, newStart: 6 }])
  })

  it('derives a running card from the call view alone', () => {
    expect(diffCardModel(running())).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }] },
      added: 1,
      removed: 1,
    })
  })

  it('derives a settled card from the result view, which replaces the call-time diff', () => {
    // The applied hunks (result) win over the args-derived call diff.
    expect(diffCardModel(settled({
      resultView: resultDiff({ diffs: [{ path: 'notes/demo.txt', oldText: 'a', newText: 'b' }] }),
    }))).toEqual({
      card: { diffs: [{ path: 'notes/demo.txt', oldText: 'a', newText: 'b' }] },
      added: 1,
      removed: 1,
    })
  })

  it('renders a settled diff even when the window dropped the call head', () => {
    // A truncated call carries only the result view, which holds the whole change.
    expect(diffCardModel(settled({ call: null, callView: null }))?.card.diffs).toHaveLength(1)
  })

  it('returns null for every non-diff call: no views, generic views, unknown cards', () => {
    expect(diffCardModel(running({ callView: null }))).toBeNull()
    expect(diffCardModel(settled({ callView: null, resultView: null }))).toBeNull()
    expect(diffCardModel(running({ callView: { card: 'generic', title: 'read x' } }))).toBeNull()
    // A generic result settles a diff call on the generic path (write/edit's
    // own execution-error arm).
    expect(diffCardModel(settled({ resultView: { card: 'generic' } }))).toBeNull()
    // A card tag this UI version does not know arrives over the wire; the
    // documented generic-card default takes it, not a crash.
    const future = { card: 'chart', title: 'plot' } as unknown as ToolCallView
    expect(diffCardModel(running({ callView: future }))).toBeNull()
    expect(diffCardModel(settled({
      callView: future, resultView: { card: 'chart' } as unknown as ToolResultView,
    }))).toBeNull()
  })

  it('falls back to null for a malformed diff payload off the wire', () => {
    // toolEventViewSchema validates only the `card` string, so a version
    // mismatch can deliver a diff card with an unusable diffs field. Each shape
    // routes to the generic path instead of throwing inside DiffBlock.
    const bad = (diffs: unknown): ToolResultView => ({ card: 'diff', diffs } as unknown as ToolResultView)
    expect(diffCardModel(settled({ resultView: bad(undefined) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad('nope') }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([null]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([{ path: 1, oldText: null, newText: 'x' }]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([{ path: 'a', oldText: 5, newText: 'x' }]) }))).toBeNull()
    expect(diffCardModel(settled({ resultView: bad([{ path: 'a', oldText: null, newText: 9 }]) }))).toBeNull()
    // The running side narrows identically.
    expect(diffCardModel(running({ callView: { card: 'diff', diffs: 'nope' } as unknown as ToolCallView }))).toBeNull()
  })
})

describe('chat row diff body', () => {
  const ownerProps = (block: RunningToolCall | ToolResultNode): GenericToolCardProps => ({
    callId: 'c1', toolName: 'edit', block, openFile: vi.fn(), t,
  })

  it('the expanded body is the complete applied diff', () => {
    const view = render(<GenericToolCard {...ownerProps(settled())} />)
    // Collapsed: the summary row (path) only, no diff body.
    expect(view.queryByText('hello fixture')).toBeNull()
    // The path link is not the expand control; the leading toggle is.
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(hasDiffRowText(view.container, 'hello fixture')).toBe(true)
    expect(view.queryByText('└ +1 -1 · 1 file')).toBeNull()
  })

  it('a running diff call expands to its intended change', () => {
    const view = render(<GenericToolCard {...ownerProps(running())} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
  })

  it('composes multiple hunks from one tool file into one file card', () => {
    const view = render(<GenericToolCard {...ownerProps(settled({
      resultView: resultDiff({
        diffs: [
          { path: 'notes/demo.txt', oldStart: 4, newStart: 4, oldText: 'old one', newText: 'new one' },
          { path: 'notes/demo.txt', oldStart: 20, newStart: 20, oldText: 'old two', newText: 'new two' },
        ],
      }),
    }))} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelectorAll('[data-diff-file]')).toHaveLength(1)
    expect(view.container.querySelectorAll('[class*="_path_"]')).toHaveLength(1)
    expect(hasDiffRowText(view.container, 'new one')).toBe(true)
    expect(hasDiffRowText(view.container, 'new two')).toBe(true)
  })

  it('a non-diff call keeps the args-JSON text body', () => {
    // A non-file tool name so the row is not single-file (no path link), and its
    // args body is the fallback the diff card must not have replaced.
    const view = render(<GenericToolCard {...{
      callId: 'c1', toolName: 'some_tool', openFile: vi.fn(), t,
      block: settled({
        call: { name: 'some_tool', argsRaw: '{"foo":"bar"}' },
        callView: null, resultView: null,
      }),
    }} />)
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.getByText(/"foo"/)).toBeTruthy()
  })

  it('a generic diff row reveals its change; a generic read keeps the host open', () => {
    const openFile = vi.fn()
    const revealChange = vi.fn()
    // Diff render intent: the path link points at the review surface.
    const diffView = render(<GenericToolCard {...{ ...ownerProps(settled()), openFile, revealChange }} />)
    fireEvent.click(diffView.getByRole('button', { name: 'demo.txt' }))
    expect(revealChange).toHaveBeenCalledWith('notes/demo.txt')
    cleanup()
    // Read intent (no diff card): the reveal share stays unconsumed and the
    // link keeps the host open behavior.
    const readView = render(<GenericToolCard {...{
      callId: 'c1', toolName: 'read', openFile, revealChange, t,
      block: settled({
        call: { name: 'read', argsRaw: '{"path":"notes/demo.txt"}' },
        callView: null, resultView: null,
      }),
    }} />)
    fireEvent.click(readView.getByRole('button', { name: 'demo.txt' }))
    expect(revealChange).toHaveBeenCalledTimes(1)
    expect(openFile).toHaveBeenCalledWith('notes/demo.txt')
  })
})

describe('FileMutationRow diff card', () => {
  const list = () => createSnapshotStore<SessionListState>({
    ids: [SID],
    byId: { [SID]: { id: SID, displayTitle: 'r', running: false, blank: false, updatedAt: 0, cwd: '/w/app' } },
    current: SID,
    phase: 'ready',
    subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined,
  })

  const rowProps = (block: RunningToolCall | ToolResultNode, toolName = 'edit'): FileMutationRowProps => ({
    callId: 'c1', toolName, block, openFile: vi.fn(), cwd: '/w/app',
    sessionId: SID, useSessions: bindSnapshotSelector(list()),
    t,
  } as unknown as FileMutationRowProps)

  /** The whole summary row is the expand toggle (ToolRow's unified interaction). */
  const toggleRow = (view: { container: HTMLElement }) => {
    fireEvent.click(view.container.querySelector('[data-expandable]')!)
  }

  it('collapses to the summary row; expanding reveals the applied diff card', () => {
    const view = render(<FileMutationRow {...rowProps(settled())} />)
    // The diff card is collapsed by default — not in the DOM until expanded.
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.queryByText('hello fixture')).toBeNull()
    expect(view.getByLabelText('+1 -1')).not.toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-diff]')).not.toBeNull()
    expect(hasDiffRowText(view.container, 'hello fixture')).toBe(true)
    expect(view.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('the summary is a path link that opens the tool path through the host', () => {
    const openFile = vi.fn()
    const view = render(<FileMutationRow {...{ ...rowProps(settled()), openFile }} />)
    // The path link rides the collapsed summary, so it opens without expanding.
    fireEvent.click(view.getByRole('button', { name: 'demo.txt' }))
    // The row passes the tool's own path; the injected openFile resolves it
    // against the session cwd (apply.ts), so the row must not resolve twice.
    expect(openFile).toHaveBeenCalledWith('notes/demo.txt')
  })

  it('the path link prefers the review reveal when the owner supplies one', () => {
    const openFile = vi.fn()
    const revealChange = vi.fn()
    const view = render(<FileMutationRow {...{ ...rowProps(settled()), openFile, revealChange }} />)
    fireEvent.click(view.getByRole('button', { name: 'demo.txt' }))
    // The mutation row's link points at the change, not the file: the reveal
    // share wins and the host open is untouched.
    expect(revealChange).toHaveBeenCalledWith('notes/demo.txt')
    expect(openFile).not.toHaveBeenCalled()
  })

  it('registers under write too, rendering a create as an added-only diff', () => {
    const writeArgs = '{"file_path":"notes/new.txt","content":"hello fixture\\n"}'
    const view = render(<FileMutationRow {...rowProps(settled({
      call: { name: 'write', argsRaw: writeArgs },
      callView: { card: 'diff', title: 'Write notes/new.txt', diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture' }] },
      resultView: { card: 'diff', title: 'Write notes/new.txt', diffs: [{ path: 'notes/new.txt', oldText: null, newText: 'hello fixture' }] },
    }), 'write')} />)
    // Write matches Edit: the title row already carries +N/-N, so the expanded
    // card does not repeat the aggregate Diff footer.
    toggleRow(view)
    expect(view.queryByText('└ +1 -0 · 1 file')).toBeNull()
  })

  it('reflects the run state on its leading slot', () => {
    const runningView = render(<FileMutationRow {...rowProps(running())} />)
    expect(runningView.container.querySelector('[data-state="running"]')).not.toBeNull()
    cleanup()
    const errorView = render(<FileMutationRow {...rowProps(settled({ isError: true, resultView: null, callView: null }))} />)
    expect(errorView.container.querySelector('[data-state="error"]')).not.toBeNull()
  })

  it('a mutation call with no diff view renders the summary row alone', () => {
    const view = render(<FileMutationRow {...rowProps(settled({ callView: null, resultView: null }))} />)
    // No diff material: expanding shows the args-JSON body, never a diff card.
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    toggleRow(view)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
  })

  it('surfaces the result text when an errored mutation has no diff card', () => {
    // write/edit return undefined from presentResult on isError, so the failure
    // has no diff — ToolRow keeps the title stable and exposes diagnostics in OUT.
    const view = render(<FileMutationRow {...rowProps(settled({
      isError: true, callView: null, resultView: null,
      content: [{ type: 'text', text: 'old_string not found in notes/demo.txt' }],
    }))} />)
    expect(view.container.querySelector('[data-diff]')).toBeNull()
    expect(view.getByText('执行失败')).toBeTruthy()
    expect(view.queryByText('old_string not found in notes/demo.txt')).toBeNull()
    toggleRow(view)
    expect(view.getByText('old_string not found in notes/demo.txt')).toBeTruthy()
  })

  it('falls back to the error name/code when an errored result has no text block', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      isError: true, callView: null, resultView: null, content: [],
      error: { name: 'ToolError', code: 'sandbox_denied' },
    }))} />)
    expect(view.getByText('执行失败')).toBeTruthy()
    expect(view.queryByText('ToolError: sandbox_denied')).toBeNull()
    toggleRow(view)
    expect(view.getByText('ToolError: sandbox_denied')).toBeTruthy()
  })

  it('shows no error summary for a successful diff or a running call', () => {
    // ToolRow's error-color summary line is set only on the error state.
    const ok = render(<FileMutationRow {...rowProps(settled())} />)
    expect(ok.container.querySelector('[class*="_errorSummary_"]')).toBeNull()
    cleanup()
    const run = render(<FileMutationRow {...rowProps(running())} />)
    expect(run.container.querySelector('[class*="_errorSummary_"]')).toBeNull()
  })

  it('shows the stopped state when the call was interrupted', () => {
    const view = render(<FileMutationRow {...rowProps(settled({
      callView: null, resultView: null, isError: true,
      error: { name: 'ToolError', code: 'interrupted' },
    }))} />)
    expect(view.container.querySelector('[data-state="stopped"]')).not.toBeNull()
    // The amber StateDot is aria-hidden, so ToolRow carries the state to AT as
    // visually-hidden text; without it a stopped row is a colour-only signal.
    expect(view.getByText('已停止')).toBeTruthy()
  })

  it('renders a plain summary span when the call carries no file path', () => {
    // Empty args leave deriveFilePath undefined, so the summary is not a link.
    const view = render(<FileMutationRow {...rowProps(settled({
      call: { name: 'edit', argsRaw: '' }, callView: null, resultView: null,
    }))} />)
    expect(view.container.querySelector('[class*="_fileLink_"]')).toBeNull()
    expect(view.container.querySelector('[class*="_summary_"]')).not.toBeNull()
  })
})

describe('fileMutationToolview registration', () => {
  it('registers one component under both edit and write, and each disposes', () => {
    const registered: { key: string; locale: unknown; disposed: boolean }[] = []
    const disposers: (() => void)[] = []
    let disposeInjection = (): void => {}
    const ctx = {
      slots: {
        inject: (_name: string, callback: () => Iterable<() => void>) => {
          const active = [...callback()]
          // The one transcript seat registers one transaction; dispose it.
          const previous = disposeInjection
          disposeInjection = () => { previous(); for (const dispose of active.reverse()) dispose() }
          return () => { for (const dispose of active.reverse()) dispose() }
        },
        register: ({ key, locale }: { name: string; key: string; locale?: string }) => {
          const entry = { key, locale, disposed: false }
          registered.push(entry)
          const dispose = () => { entry.disposed = true }
          disposers.push(dispose)
          return dispose
        },
      },
    }
    fileMutationToolview.apply(ctx as never)
    // Activity invokes this same transcript seat instead of mirroring it.
    expect(registered.map(r => r.key).sort()).toEqual(['edit', 'write'])
    // Both keys claim the conversation locale seat ToolRow's body copy needs.
    expect(registered.map(r => r.locale)).toEqual(['conversation', 'conversation'])
    expect(fileMutationToolview.inject).toEqual(['slots'])
    // Disposal removes each contribution (packages/AGENTS.md registry contract).
    disposeInjection()
    expect(registered.every(r => r.disposed)).toBe(true)
  })
})
