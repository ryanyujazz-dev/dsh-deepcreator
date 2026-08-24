import { describe, expect, it, vi } from 'vitest'
import { isBrowserToolOwner } from '../src/index.ts'
import { createBrowserToolDefinitions } from '../src/tools.ts'

describe('Browser Agent tool contract', () => {
  it('publishes one shared six-tool definition set for Native and generated Code SDK use', () => {
    const tools = createBrowserToolDefinitions({ runtime: {} as never, approval: {} as never, turnOf: () => 0 })
    expect(tools.map(tool => tool.name)).toEqual(['browser_list', 'browser_tabs', 'browser_navigate', 'browser_inspect', 'browser_act', 'browser_wait'])
    expect(tools.every(tool => tool.output.schema !== undefined && typeof tool.output.render === 'function')).toBe(true)
    const act = tools.find(tool => tool.name === 'browser_act')!
    const keys = Object.keys((act.parameters as { properties?: object }).properties ?? act.parameters)
    expect(keys).toEqual(expect.arrayContaining(['destination', 'steps', 'expectedUrl', 'observe']))
  })

  it('grants Browser tools to root Agents and not ordinary subagents', () => {
    const root = {} as never; const child = {} as never
    const agents = { roots: () => [root] }
    expect(isBrowserToolOwner(agents, root)).toBe(true)
    expect(isBrowserToolOwner(agents, child)).toBe(false)
  })

  it('classifies a node-ref click from authoritative element semantics before acting', async () => {
    const execute = vi.fn(async (_sessionId: string, _tabId: string, command: { kind: string; action: string }) => {
      if (command.kind === 'inspect') return {
        kind: 'elementInfo',
        element: { nodeRef: 'n1', role: 'button', name: 'Delete project' },
        tab: {},
      }
      return { kind: 'state', tab: {} }
    })
    const request = vi.fn(async () => 'allowed-once' as const)
    const tools = createBrowserToolDefinitions({
      runtime: {
        execute,
        tab: () => ({ url: 'https://example.test/settings' }),
      } as never,
      approval: { request } as never,
      turnOf: () => 1,
    })
    const act = tools.find(tool => tool.name === 'browser_act')!
    const signal = new AbortController().signal
    await act.execute({
      tabId: 'tab-1', action: 'click',
      locator: { kind: 'node', snapshotId: 'snapshot-1', nodeRef: 'n1' },
    }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } },
      callId: 'call-1', rootCallId: 'call-1', name: 'browser_act', arguments: {}, signal,
    } as never)

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0].reason).toContain('Delete project')
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('requires user approval before returning an interrupted tab to Agent control', async () => {
    const reacquire = vi.fn(() => ({ tabId: 'tab-1', browserId: 'iab' }))
    const request = vi.fn(async () => 'denied' as const)
    const tools = createBrowserToolDefinitions({
      runtime: {
        tab: () => ({ tabId: 'tab-1', browserId: 'iab', url: 'https://example.test/' }),
        reacquire,
      } as never,
      approval: { request } as never,
      turnOf: () => 1,
    })
    const tabs = tools.find(tool => tool.name === 'browser_tabs')!
    const signal = new AbortController().signal

    await expect(tabs.execute({ operation: 'reacquire', tabId: 'tab-1' }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } },
      callId: 'call-2', rootCallId: 'call-2', name: 'browser_tabs', arguments: {}, signal,
    } as never)).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })
    expect(request).toHaveBeenCalledOnce()
    expect(reacquire).not.toHaveBeenCalled()
  })

  it('submits multi-step actions as one transaction and can return a fresh observation', async () => {
    const execute = vi.fn(async (_sessionId: string, _tabId: string, command: { kind: string; action?: string; observe?: string }) => {
      if (command.kind === 'inspect' && command.action === 'elementInfo') return { kind: 'elementInfo', element: { nodeRef: 'semantic', role: 'textbox', name: 'Search docs' }, tab: {} }
      if (command.kind === 'act') return { kind: 'action', outcome: { actionApplied: true, completedSteps: 2, durationMs: 4, postcondition: { kind: 'navigation', status: 'satisfied' } }, ...(command.observe === 'snapshot' ? { observation: { snapshotId: 'snapshot-2', url: 'https://example.test/results', title: 'Results', text: '', nodes: [] } } : {}), tab: { url: 'https://example.test/results' } }
      return { kind: 'state', tab: { url: 'https://example.test/results' } }
    })
    const tools = createBrowserToolDefinitions({
      runtime: { execute, tab: () => ({ url: 'https://example.test/docs' }) } as never,
      approval: { request: vi.fn(async () => 'allowed-once' as const) } as never,
      turnOf: () => 1,
    })
    const act = tools.find(tool => tool.name === 'browser_act')!
    const value = await act.execute({
      tabId: 'tab-1',
      steps: [
        { action: 'fill', locator: { kind: 'role', role: 'textbox', name: 'Search docs' }, value: 'codex cli' },
        { action: 'press', locator: { kind: 'role', role: 'textbox', name: 'Search docs' }, value: 'Enter' },
      ],
      expected: 'navigation', expectedUrl: '**/results', urlMatch: 'glob', observe: 'snapshot',
    }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-sequence', rootCallId: 'call-sequence', name: 'browser_act', arguments: {}, signal: new AbortController().signal,
    } as never)

    expect(value).toMatchObject({ kind: 'action', observation: { snapshotId: 'snapshot-2', nodeCount: 0 } })
    expect(execute).toHaveBeenCalledWith('agent-1', 'tab-1', expect.objectContaining({ kind: 'act', steps: expect.arrayContaining([expect.objectContaining({ action: 'fill' }), expect.objectContaining({ action: 'press' })]), expectedUrl: '**/results' }), expect.anything())
  })

  it('rejects fill plus navigation before preflight or mutation', async () => {
    const execute = vi.fn(); const request = vi.fn()
    const tools = createBrowserToolDefinitions({ runtime: { execute } as never, approval: { request } as never, turnOf: () => 1 })
    const act = tools.find(tool => tool.name === 'browser_act')!

    await expect(act.execute({ tabId: 'tab-1', action: 'fill', locator: { kind: 'role', role: 'textbox', name: 'Search' }, value: 'DeepSeek', expected: 'navigation' }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-invalid', rootCallId: 'call-invalid', name: 'browser_act', arguments: {}, signal: new AbortController().signal,
    } as never)).rejects.toMatchObject({ code: 'INVALID_ACTION' })
    expect(execute).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled()
  })

  it('does not ask approval for Enter on a search control and records preflight phases', async () => {
    const recordToolEvent = vi.fn()
    const execute = vi.fn(async (_sessionId: string, _tabId: string, command: { kind: string; action?: string }) => command.kind === 'inspect'
      ? { kind: 'elementInfo', element: { nodeRef: 'semantic', role: 'combobox', name: '在此处输入你的搜索' }, tab: {} }
      : { kind: 'action', outcome: { actionApplied: true, completedSteps: 1, durationMs: 2, postcondition: { kind: 'navigation', status: 'satisfied' } }, tab: { url: 'https://example.test/results' } })
    const request = vi.fn()
    const tools = createBrowserToolDefinitions({ runtime: { execute, recordToolEvent, tab: () => ({ url: 'https://example.test/' }) } as never, approval: { request } as never, turnOf: () => 1 })
    const act = tools.find(tool => tool.name === 'browser_act')!

    await act.execute({ tabId: 'tab-1', action: 'press', locator: { kind: 'role', role: 'combobox', name: '在此处输入你的搜索', exact: true }, value: 'Enter', expected: 'navigation' }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-search', rootCallId: 'call-search', name: 'browser_act', arguments: {}, signal: new AbortController().signal,
    } as never)
    expect(request).not.toHaveBeenCalled()
    expect(recordToolEvent).toHaveBeenCalledWith('agent-1', 'tab-1', expect.objectContaining({ kind: 'preflight-start' }))
    expect(recordToolEvent).toHaveBeenCalledWith('agent-1', 'tab-1', expect.objectContaining({ kind: 'preflight-complete' }))
  })

  it('aggregates every side-effecting step into one approval before the transaction mutates the page', async () => {
    const request = vi.fn(async () => 'allowed-once' as const)
    const execute = vi.fn(async (_sessionId: string, _tabId: string, command: { kind: string; action?: string; locator?: { kind: string; role?: string } }) => {
      if (command.kind === 'inspect') return command.locator?.role === 'textbox'
        ? { kind: 'elementInfo', element: { nodeRef: 'name', role: 'textbox', name: 'Full name', autocomplete: 'name' }, tab: {} }
        : { kind: 'elementInfo', element: { nodeRef: 'submit', role: 'button', name: 'Submit order', inputType: 'submit' }, tab: {} }
      return { kind: 'action', outcome: { actionApplied: true, completedSteps: 2, durationMs: 3, postcondition: { kind: 'none', status: 'not-requested' } }, tab: { url: 'https://example.test/order' } }
    })
    const tools = createBrowserToolDefinitions({
      runtime: { execute, tab: () => ({ url: 'https://example.test/order' }) } as never,
      approval: { request } as never,
      turnOf: () => 1,
    })
    const act = tools.find(tool => tool.name === 'browser_act')!

    await act.execute({
      tabId: 'tab-1',
      steps: [
        { action: 'fill', locator: { kind: 'role', role: 'textbox', name: 'Full name', exact: true }, value: 'Ada Lovelace' },
        { action: 'click', locator: { kind: 'role', role: 'button', name: 'Submit order', exact: true } },
      ],
    }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-approved-transaction', rootCallId: 'call-approved-transaction', name: 'browser_act', arguments: {}, signal: new AbortController().signal,
    } as never)

    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0]?.[0].reason).toContain('fill target')
    expect(request.mock.calls[0]?.[0].reason).toContain('click target')
    expect(execute.mock.calls.filter(call => call[2].kind === 'act')).toHaveLength(1)
  })

  it('ends a denied approval without a duplicate preflight completion or a partial action', async () => {
    const recordToolEvent = vi.fn()
    const execute = vi.fn(async (_sessionId: string, _tabId: string, command: { kind: string }) => command.kind === 'inspect'
      ? { kind: 'elementInfo', element: { nodeRef: 'submit', role: 'button', name: 'Submit order', inputType: 'submit' }, tab: {} }
      : { kind: 'state', tab: {} })
    const tools = createBrowserToolDefinitions({
      runtime: { execute, recordToolEvent, tab: () => ({ url: 'https://example.test/order' }) } as never,
      approval: { request: vi.fn(async () => 'denied' as const) } as never,
      turnOf: () => 1,
    })
    const act = tools.find(tool => tool.name === 'browser_act')!

    await expect(act.execute({ tabId: 'tab-1', action: 'click', locator: { kind: 'role', role: 'button', name: 'Submit order', exact: true } }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-denied-transaction', rootCallId: 'call-denied-transaction', name: 'browser_act', arguments: {}, signal: new AbortController().signal,
    } as never)).rejects.toMatchObject({ code: 'APPROVAL_DENIED' })

    expect(recordToolEvent.mock.calls.filter(call => call[2].kind === 'preflight-complete')).toHaveLength(1)
    expect(recordToolEvent).toHaveBeenCalledWith('agent-1', 'tab-1', expect.objectContaining({ kind: 'approval-denied' }))
    expect(execute.mock.calls.filter(call => call[2].kind === 'act')).toHaveLength(0)
  })

  it('projects snapshots without duplicating the full internal node array', async () => {
    const tools = createBrowserToolDefinitions({
      runtime: { execute: vi.fn(async () => ({ kind: 'snapshot', snapshot: { snapshotId: 'snapshot-1', url: 'https://example.test/', title: 'Example', text: 'n1 link "Docs"', nodes: [{ nodeRef: 'n1', role: 'link', name: 'Docs', href: 'https://example.test/docs?token=secret', target: '_blank', opensNewTab: true }] }, tab: { url: 'https://example.test/' } })) } as never,
      approval: {} as never, turnOf: () => 1,
    })
    const inspect = tools.find(tool => tool.name === 'browser_inspect')!
    const value = await inspect.execute({ tabId: 'tab-1', action: 'snapshot' }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-snapshot', rootCallId: 'call-snapshot', name: 'browser_inspect', arguments: {}, signal: new AbortController().signal,
    } as never) as Record<string, unknown>
    expect(value).toMatchObject({ snapshot: { nodeCount: 1, links: [expect.objectContaining({ nodeRef: 'n1', opensNewTab: true })] } })
    expect(JSON.stringify(value)).not.toContain('"nodes"')
    expect(JSON.stringify(value)).not.toContain('token=secret')
  })

  it('renders screenshot metadata and a durable image block without attachment JSON in OUT text', async () => {
    const attachment = { attachmentId: 'attachment-1', mediaType: 'image/png', bytes: 12, width: 100, height: 50 }
    const tools = createBrowserToolDefinitions({
      runtime: {
        execute: vi.fn(async () => ({ kind: 'screenshot', dataUrl: 'data:image/png;base64,AA==', tab: { url: 'https://example.test/', title: 'Example' } })),
        tab: () => ({ snapshotAttachment: attachment }),
      } as never,
      approval: {} as never,
      turnOf: () => 1,
    })
    const inspect = tools.find(tool => tool.name === 'browser_inspect')!
    const value = await inspect.execute({ tabId: 'tab-1', action: 'screenshot' }, {
      agent: { id: 'agent-1', session: { header: { cwd: '/workspace' } } }, callId: 'call-3', rootCallId: 'call-3', name: 'browser_inspect', arguments: {}, signal: new AbortController().signal,
    } as never)
    const content = inspect.output.render({}, value)
    expect(content).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('"attachmentId":"attachment-1"') }),
      { type: 'image', attachment },
    ])
    expect((content[0] as { text: string }).text).not.toContain('"attachment":')
  })
})
