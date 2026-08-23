import { describe, expect, it, vi } from 'vitest'
import { isBrowserToolOwner } from '../src/index.ts'
import { createBrowserToolDefinitions } from '../src/tools.ts'

describe('Browser Agent tool contract', () => {
  it('publishes one shared six-tool definition set for Native and generated Code SDK use', () => {
    const tools = createBrowserToolDefinitions({ runtime: {} as never, approval: {} as never, turnOf: () => 0 })
    expect(tools.map(tool => tool.name)).toEqual(['browser_list', 'browser_tabs', 'browser_navigate', 'browser_inspect', 'browser_act', 'browser_wait'])
    expect(tools.every(tool => tool.output.schema !== undefined && typeof tool.output.render === 'function')).toBe(true)
    const act = tools.find(tool => tool.name === 'browser_act')!
    expect(Object.keys((act.parameters as { properties?: object }).properties ?? act.parameters)).toContain('destination')
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
})
