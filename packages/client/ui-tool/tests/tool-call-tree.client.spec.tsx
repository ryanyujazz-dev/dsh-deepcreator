// @vitest-environment jsdom
/** ToolCallTree-owned root/subcall markers. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ConversationSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@ryanyujazz/dsh-client-locale/src/locales/zh.ts'
import type { ToolTreeProps } from '../src/client/contract/slots.ts'
import { ToolCallTree } from '../src/client/tool/ToolCallTree.tsx'
import { zh } from '@ryanyujazz/dsh-client-ui-conversation/src/client/locales.ts'

afterEach(cleanup)

const t: ToolTreeProps['t'] = makeTranslate(zh, commonZh)

const root = (callId: string, call: ToolResultNode['call']): ToolResultNode => ({
  kind: 'tool-result', seq: 3, time: 3_000, callId, call, callTime: 2_000,
  content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

function props(
  block: ToolResultNode,
  thinkMode?: ToolTreeProps['thinkMode'],
): ToolTreeProps {
  const snapshot = {} as ConversationSnapshot
  const useSession = ((selector: (value: ConversationSnapshot) => unknown) => selector(snapshot)) as ToolTreeProps['useSession']
  const renderSlot = ((_key: string, _owner: object, options?: { fallback?: React.ReactNode }) =>
    options?.fallback ?? null) as unknown as ToolTreeProps['renderSlot']
  return {
    useSession,
    renderSlot,
    node: {
      key: `tool:${block.callId}`,
      kind: 'tool-call',
      id: block.callId,
      target: 'chat',
      anchorSeq: block.seq,
      location: { kind: 'session' },
      visibility: 'visible',
      data: { root: block },
    },
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    fileMentions: vi.fn(),
    thinkMode,
    t,
  } as unknown as ToolTreeProps
}

describe('ToolCallTree', () => {
  it('owns the root marker and generic fallback for a window-truncated call', () => {
    const block = root('w1', null)
    const view = render(<ToolCallTree {...props(block)} />)
    const row = view.container.querySelector('[data-chat-call-id="w1"]')
    expect(row?.getAttribute('data-chat-anchor-key')).toBe('call:w1')
    expect(view.container.querySelector('[data-variant="others"]')).not.toBeNull()
    expect(view.getByText('w1')).toBeTruthy()
  })

  it('marks every call boundary when the execution-flow chrome is active', () => {
    const leaf = root('parent:code:1', { name: 'skill', argsRaw: '{"skill":"demo"}' })
    const block = {
      ...root('parent', { name: 'run_code', argsRaw: '{"code":"return 1"}' }),
      subCalls: [leaf],
    }
    const view = render(<ToolCallTree {...props(block, 'inline')} />)
    const rows = view.container.querySelectorAll('[data-chat-call-id][data-execflow]')
    expect(rows).toHaveLength(2)
  })
})
