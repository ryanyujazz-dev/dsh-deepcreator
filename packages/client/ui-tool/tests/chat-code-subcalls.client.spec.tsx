// @vitest-environment jsdom
// Code Mode sub-call acceptance on the REAL machinery stack (same bench as
// toolview-slot.client.spec): a run_code result renders the 'code' variant row
// (description summary, program body), its logged sub-dispatches render as
// always-visible nested rows through the SAME keyed toolview hole — the bash
// sub-call lands in the bash sample plugin's registration exactly like a
// top-level bash row, unregistered sub-tools fall back to GenericToolCard —
// and a file sub-row click opens the host path. Running parents
// (the unsettled tool/call tail) nest their so-far dispatches the same way.

import { stubSettingsScope, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import {
  type RunningToolCall,
  type ToolCallBlock,
  type ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type ISession,
} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  type SessionId,
} from '@deepseek-ai/dsh-session/types'

import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { apply as applyConversation, inject as injectConversation } from '@ryanyujazz/dsh-client-ui-conversation/client'
import { apply as applyTool, inject as injectTool } from '../src/client/apply.ts'
import { toolCallEvents } from './tool-details-render.client.tsx'

const SID = 's1' as SessionId

/** jsdom has no ResizeObserver; the composer seat publishes its height through one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

const PROGRAM = 'const listing = await tools.bash({ command: "ls notes", description: "List notes" })\nreturn listing'
const RUN_CODE_ARGS = JSON.stringify({ code: PROGRAM, description: 'List the notes directory' })

const codeResult = (seq: number, callId: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name: 'run_code', argsRaw: RUN_CODE_ARGS },
  callTime: seq * 1_000 - 500,
  content: [{ type: 'text', text: 'demo.txt' }], isError: false, callView: null, resultView: null,
  subCalls: [],
})

const runningCode = (callId: string): RunningToolCall => ({
  callId, name: 'run_code', argsRaw: RUN_CODE_ARGS, turn: 9, step: 0, time: 9_000, callView: null,
  subCalls: [],
})

const subCall = (
  seq: number, parent: string, n: number, name: string, args: object, resultText: string, isError = false,
): ToolCallBlock => ({
  kind: 'tool-result', seq, time: seq * 1_000,
  callId: `${parent}:code:${n}`,
  call: { name, argsRaw: JSON.stringify(args) },
  callTime: seq * 1_000,
  content: [{ type: 'text', text: resultText }], isError, callView: null, resultView: null,
  subCalls: [],
})

/**
 * Same real-stack bench as the toolview-slot spec: SlotTestRuntime (real
 * Cordis Context + SlotRegistry + ui-session adapter + renderer) with the
 * session/workspace doubles at the service boundaries only, both owning
 * package applies, and the test AppFrame occupying 'root'. Conversation data
 * rides the durable event feed the way production assembly consumes it.
 */
async function bench(
  nodes: ToolResultNode[],
  subCalls: readonly ToolCallBlock[],
  runningCalls: RunningToolCall[] = [],
  isLoopback = false,
  remoteOpenPath?: (args: { path: string }) => Promise<void>,
) {
  const runtime = await SlotTestRuntime.create()
  runtime.ctx.provide('connection', { api: { settings: {} }, isLoopback })
  // ui-theme's Appearance row binds a durable scope through these two. The
  // conversation scope publishes the stock 'normal' flow: the shipped default
  // ('classic') aggregates settled tool runs behind one morphing header.
  const settings = stubSettingsScope<never>()
  settings.publish({ value: { defaultRenderMode: 'normal' } } as never)
  runtime.ctx.provide('remote', { $on: () => () => {}, session: { openWorkspacePath: remoteOpenPath } })
  runtime.ctx.provide('settingsScope', { bind: () => settings.scope } as never)
  const layout = { closeDetails: vi.fn() }
  runtime.ctx.provide('layout', layout)
  const locale = new LocaleRuntime(runtime.ctx)
  runtime.ctx.provide('locale', locale)
  runtime.slots.installLocale(locale)
  const nestedNodes = nodes.map(node => ({ ...node, subCalls }))
  const nestedRunning = runningCalls.map(call => ({ ...call, subCalls }))
  await runtime.sessions.add({
    id: SID,
    summary: { title: 'S', displayTitle: 'S', cwd: '/proj' },
    events: toolCallEvents(nestedNodes, nestedRunning),
    session: {
      loadOlder: vi.fn<ISession['loadOlder']>(),
      prompt: vi.fn<ISession['prompt']>(async () => ({ ok: true, value: { accepted: true } })),
    },
  })
  await runtime.root.declare({
    'conversation': { kind: 'single', scope: 'session-maybe' },
  } as const, ({ renderSlot }: { renderSlot: (key: 'conversation') => React.ReactNode }) => (
    <>{renderSlot('conversation')}</>
  ))
  await runtime.mount({ inject: [...injectConversation], apply: applyConversation })
  await runtime.mount({ inject: [...injectTool], apply: applyTool })
  return { runtime, layout, workspaces: runtime.workspaces }
}

function mountApp(b: Awaited<ReturnType<typeof bench>>) {
  return b.runtime.renderRoot()
}

describe('run_code sub-calls through the real chat machinery', () => {
  it('renders the code-variant parent row with the description summary and nested sub-rows', async () => {
    const parent = 'call-64'
    const subCalls = [
      subCall(11, parent, 1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
      subCall(12, parent, 2, 'mystery', { n: 1 }, 'ok'),
    ]
    const b = await bench([codeResult(10, parent)], subCalls)
    const view = mountApp(b)

    // Parent row: the code variant with the model-authored description.
    const codeRoot = view.container.querySelector('[data-variant="code"]')
    expect(codeRoot).not.toBeNull()
    expect(view.getByText('Code')).toBeTruthy()
    expect(view.getByText('List the notes directory')).toBeTruthy()

    // Nested rows are ALWAYS visible (no parent expand needed): the bash
    // sub-call landed in the bash sample plugin's keyed registration — Bash ·
    // description chrome, same as a top-level bash row — and the unregistered
    // sub-tool fell back to GenericToolCard at the same render site.
    const nest = view.container.querySelector('[data-subcalls]')
    expect(nest).not.toBeNull()
    expect(nest!.querySelector('[data-sample="bash"]')).not.toBeNull()
    expect(view.getByText('Bash')).toBeTruthy()
    expect(view.getByText('List notes')).toBeTruthy()
    expect(view.getByText('Tool call')).toBeTruthy()
    await b.runtime.dispose()
  })

  it('renders Cordis sub-calls with lifecycle titles over the generic variants', async () => {
    const parent = 'call-cordis'
    const subCalls = [
      subCall(11, parent, 1, 'cordis_runtime_inspect', { what: 'temporary' }, '## Dynamic Packages'),
      subCall(12, parent, 2, 'cordis_run', { id: 'dyn-2' }, 'Dynamic package dyn-2 is running'),
      subCall(13, parent, 3, 'cordis_undefine', { id: 'dyn-2' }, 'Dynamic package dyn-2 was discarded.'),
    ]
    const b = await bench([codeResult(10, parent)], subCalls)
    const view = mountApp(b)
    const nest = view.container.querySelector('[data-subcalls]')!

    // Each run-control verb names its act and shows the package id; without the
    // owned titles all three would read "Tool call · cordis_run · dyn-2".
    expect(nest.querySelector('[data-tool="cordis_runtime_inspect"]')?.textContent).toContain('Inspect')
    expect(nest.querySelector('[data-tool="cordis_run"]')?.textContent).toContain('Run Cordis Plugindyn-2')
    expect(nest.querySelector('[data-tool="cordis_undefine"]')?.textContent).toContain('Remove Cordis Plugindyn-2')
    // None of them is a code row: the program belongs to cordis_define, whose
    // own keyed card renders it (the next case covers the code row itself).
    expect(nest.querySelector('[data-variant="code"]')).toBeNull()
    await b.runtime.dispose()
  })

  it('expanding the code row reveals the program body verbatim (shiki-tokenized)', async () => {
    const parent = 'call-64'
    const b = await bench([codeResult(10, parent)], [])
    const view = mountApp(b)
    // The code row is expandable via the whole summary row (body = the program).
    const toggle = view.container.querySelector('[data-variant="code"] [data-expandable]')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle!)
    // Shiki splits the program into token spans inside one <pre class="shiki">:
    // assert the whole text and the highlighted tree rather than one node.
    const pre = view.container.querySelector('pre.shiki')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('const listing = await tools.bash')
    expect(pre!.querySelectorAll('span[style]').length).toBeGreaterThan(3)
    await b.runtime.dispose()
  })

  it('an isError sub-call renders the error state dot exactly like a failed native row', async () => {
    const parent = 'call-64'
    const subCalls = [
      subCall(11, parent, 1, 'mystery', { n: 1 }, 'Error: boom', true),
    ]
    const b = await bench([codeResult(10, parent)], subCalls)
    const view = mountApp(b)
    const nested = view.container.querySelector('[data-subcalls] [data-variant][data-state="error"]')
    expect(nested).not.toBeNull()
    await b.runtime.dispose()
  })

  it('a file sub-row click opens the host path', async () => {
    const parent = 'call-64'
    const subCalls = [
      subCall(11, parent, 1, 'read', { path: 'notes/demo.txt' }, 'ok'),
      subCall(12, parent, 2, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
    ]
    // The host open rides the remote session namespace on loopback builds; the
    // sub-row resolves the relative read path against the session cwd first.
    const remoteOpenPath = vi.fn(() => Promise.resolve())
    const b = await bench([codeResult(10, parent)], subCalls, [], true, remoteOpenPath)
    const view = mountApp(b)
    view.getByText('demo.txt').click()
    await vi.waitFor(() => {
      expect(remoteOpenPath).toHaveBeenCalledWith({ path: '/proj/notes/demo.txt' })
    })
    await b.runtime.dispose()
  })

  it('a RUNNING run_code call nests its so-far dispatches under the spinner row', async () => {
    const parent = 'call-live'
    const subCalls = [
      subCall(21, parent, 1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt'),
    ]
    const b = await bench([], subCalls, [runningCode(parent)])
    const view = mountApp(b)
    const running = view.container.querySelector('[data-variant="code"][data-state="running"]')
    expect(running).not.toBeNull()
    const nest = view.container.querySelector('[data-subcalls]')
    expect(nest).not.toBeNull()
    expect(nest!.querySelector('[data-sample="bash"]')).not.toBeNull()
    await b.runtime.dispose()
  })

  it('a started-but-unsettled sub-call renders the running state exactly like a native in-flight row', async () => {
    const parent = 'call-live'
    const runningSub: ToolCallBlock = {
      callId: `${parent}:code:1`, name: 'grep', argsRaw: '{"pattern":"todo"}',
      turn: 0, step: 0, time: 21_000, callView: null, subCalls: [],
    }
    const b = await bench([], [runningSub], [runningCode(parent)])
    const view = mountApp(b)
    // The nested row derives 'running' from the RunningToolCall shape — the
    // same data-state chrome (row sweep) a native in-flight row wears.
    const nested = view.container.querySelector('[data-subcalls] [data-variant][data-state="running"]')
    expect(nested).not.toBeNull()
    await b.runtime.dispose()
  })

  it('an ordinary tool row renders no sub-call nest', async () => {
    const parent = 'call-64'
    const plain: ToolResultNode = {
      kind: 'tool-result', seq: 10, time: 10_000, callId: parent,
      call: { name: 'mystery', argsRaw: '{"n":1}' },
      callTime: 9_500,
      content: [], isError: false, callView: null, resultView: null, subCalls: [],
    }
    const b = await bench([plain], [])
    const view = mountApp(b)
    expect(view.container.querySelector('[data-subcalls]')).toBeNull()
    await b.runtime.dispose()
  })
})
