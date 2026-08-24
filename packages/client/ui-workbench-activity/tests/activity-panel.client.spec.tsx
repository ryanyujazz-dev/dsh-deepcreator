// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobView, SessionId, SessionSummary, SubagentAddress, SubagentCatalogSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ActivityPanel, formatDuration, groupSubagents, isLive, jobIdFromInstance, jobInstanceId,
  subagentRows, type SubagentRow,
} from '../src/client/ActivityPanel.tsx'
import type { ActivityInjected } from '../src/client/injected.ts'
import { formatTokens, tokenTotal } from '../src/client/SubagentTab.tsx'
import type { ActivityKey } from '../src/client/locales.ts'

const SESSION = 'session-1' as SessionId

/** Locale stub with brace interpolation so duration/count text is assertable. */
const t = (key: ActivityKey | string, values?: Record<string, unknown>): string =>
  values === undefined ? key : `${key}:${Object.entries(values).map(([k, v]) => `${k}=${v}`).join(',')}`

interface ListState {
  byId: Record<string, SessionSummary>
  currentAddress: SubagentAddress | undefined
  jobsBySession: Record<string, readonly JobView[]>
  subagentsByParent: Record<string, SubagentCatalogSnapshot>
}

function makeUseSessions(state: ListState) {
  return (selector: (snapshot: ListState) => unknown) => selector(state)
}

function job(overrides: Partial<JobView> & Pick<JobView, 'id' | 'status' | 'startedAt'>): JobView {
  return { kind: 'bash', label: `label-${overrides.id}`, detail: undefined, finishedAt: undefined, ...overrides }
}

function panelProps(state: ListState, injected: Partial<ActivityInjected> = {}, owner: {
  route?: 'home' | 'instance'
  tabs?: readonly string[]
  activeInstanceId?: string
} = {}) {
  return {
    typeId: 'activity',
    route: owner.route ?? 'home',
    tabs: owner.tabs ?? [],
    activeInstanceId: owner.activeInstanceId,
    openInstance: vi.fn(),
    activateInstance: vi.fn(),
    closeInstance: vi.fn(),
    showHome: vi.fn(),
    contributeHeaderActions: () => () => undefined,
    contributePanelInfo: () => () => undefined,
    renderArtifact: () => null,
    sessionId: SESSION,
    useSessions: makeUseSessions(state),
    visible: true,
    stopJob: vi.fn(async () => ({ ok: true as const })),
    subagentOverview: vi.fn(async () => ({ ok: true as const, children: [] })),
    renderSlot: Object.assign((key: string, owner: unknown) => ({ key, owner }), { subscribe: () => () => {}, version: () => 0 }),
    openInConversation: vi.fn(),
    closeFromConversation: vi.fn(),
    t,
    ...injected,
  }
}

const catalog = (entries: SubagentCatalogSnapshot['entries']): SubagentCatalogSnapshot =>
  ({ entries, state: 'ready', error: null, parentAvailable: true })

describe('activity helpers', () => {
  it('formats durations in two adjacent units', () => {
    expect(formatDuration(42_000, t)).toBe('duration.seconds:seconds=42')
    expect(formatDuration(125_000, t)).toBe('duration.minutes:minutes=2,seconds=5')
    expect(formatDuration(3_725_000, t)).toBe('duration.hours:hours=1,minutes=2')
  })

  it('detects live jobs', () => {
    expect(isLive({ status: 'running' })).toBe(true)
    expect(isLive({ status: 'stopping' })).toBe(true)
    expect(isLive({ status: 'completed' })).toBe(false)
  })

  it('namespaces job tabs away from child Session ids', () => {
    expect(jobInstanceId('bash-7')).toBe('job:bash-7')
    expect(jobIdFromInstance('job:bash-7')).toBe('bash-7')
    expect(jobIdFromInstance('session-child-1')).toBeUndefined()
  })

  it('orders subagent rows running-first with label fallback', () => {
    const byId = {
      'session-child-2': { displayTitle: '目录标题二' } as SessionSummary,
    }
    const rows = subagentRows(catalog([
      { kind: 'child', id: 'session-child-2' as SessionId, activity: 'inactive', hasChildren: false, mode: 'continuable', label: '委派二' },
      { kind: 'child', id: 'session-child-1' as SessionId, activity: 'running', hasChildren: false, mode: 'one-shot', label: undefined as unknown as string },
      { kind: 'diagnostic', id: 'session-broken' as SessionId, reason: 'corrupt' },
    ]), byId)
    // Catalog order; ordering belongs to the cohort grouping.
    expect(rows.map(row => row.id)).toEqual(['session-child-2', 'session-child-1'])
    expect(rows[0]?.label).toBe('委派二')
    expect(rows[1]?.label).toBe('session-child-1')
  })

  it('sums token buckets compactly', () => {
    const usage = { uncachedInputTokens: 700, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 0 } as never
    expect(tokenTotal(usage)).toBe(1900)
    expect(formatTokens(1900)).toBe('1.9K')
  })
})

describe('groupSubagents cohort split', () => {
  const rows: SubagentRow[] = [
    { id: 'session-old' as SessionId, label: '旧代理', mode: 'continuable', activity: 'inactive' },
    { id: 'session-now' as SessionId, label: '本轮代理', mode: 'one-shot', activity: 'inactive' },
    { id: 'session-revived' as SessionId, label: '复用代理', mode: 'continuable', activity: 'inactive' },
    { id: 'session-live' as SessionId, label: '运行代理', mode: 'one-shot', activity: 'running' },
  ]

  it('keeps this-turn children on top, most recently active first', () => {
    const cohort = groupSubagents(rows, {
      ok: true,
      turnStartedAt: 1_000,
      children: [
        { id: 'session-old', running: false, lastActiveAt: 500 },
        { id: 'session-now', running: false, lastActiveAt: 1_200 },
        { id: 'session-revived', running: false, lastActiveAt: 1_500 },
        { id: 'session-live', running: true, lastActiveAt: 1_400 },
      ],
    })
    // Running first, then recency: the re-invoked continuable child sits above
    // the newer one-off because its latest activity is fresher.
    expect(cohort.turn.map(row => row.id)).toEqual(['session-live', 'session-revived', 'session-now'])
    expect(cohort.earlier.map(row => row.id)).toEqual(['session-old'])
  })

  it('collapses to one flat list without an overview (running first)', () => {
    const cohort = groupSubagents(rows, undefined)
    expect(cohort.turn).toEqual([])
    expect(cohort.earlier.map(row => row.id)).toEqual(['session-live', 'session-old', 'session-now', 'session-revived'])
  })
})

describe('ActivityPanel home route', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('renders running and finished sections with official ordering', () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [
        job({ id: 'bash-1', status: 'completed', startedAt: 1_000, finishedAt: 9_000 }),
        job({ id: 'bash-2', status: 'running', startedAt: 5_000 }),
        job({ id: 'bash-3', status: 'running', startedAt: 2_000 }),
      ] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const view = render(<ActivityPanel {...panelProps(state)} />)
    const live = screen.getAllByText(/^label-bash-/)
    expect(live.map(node => node.textContent)).toEqual(['label-bash-3', 'label-bash-2', 'label-bash-1'])
    expect(view.container.textContent).toContain('section.live')
    expect(view.container.textContent).toContain('section.finished')
  })

  it('ticks the live duration every second', () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [job({ id: 'bash-1', status: 'running', startedAt: Date.now() - 500 })] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const view = render(<ActivityPanel {...panelProps(state)} />)
    expect(view.container.textContent).toContain('duration.seconds:seconds=0')
    act(() => { vi.advanceTimersByTime(2100) })
    expect(view.container.textContent).toContain('duration.seconds:seconds=2')
  })

  it('stops a live job optimistically and reverts on failure', async () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [job({ id: 'bash-1', status: 'running', startedAt: Date.now() })] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const stopJob = vi.fn(async () => ({ ok: false as const, code: 'NOT_LIVE' as const, message: 'settled' }))
    const props = panelProps(state, { stopJob })
    const view = render(<ActivityPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(stopJob).toHaveBeenCalledExactlyOnceWith(SESSION, 'bash-1')
    expect(props.openInstance).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(view.container.textContent).toContain('stop.failed')
    expect(screen.getByRole('button', { name: 'stop' }).hasAttribute('disabled')).toBe(false)
  })

  it('opens running and settled jobs as keyboard-accessible Workbench tabs', () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [
        job({ id: 'bash-1', status: 'running', startedAt: Date.now() }),
        job({ id: 'bash-2', status: 'completed', startedAt: 1_000, finishedAt: 2_000 }),
      ] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const props = panelProps(state)
    render(<ActivityPanel {...props} />)

    const running = screen.getByRole('button', { name: /label-bash-1/ })
    fireEvent.click(running)
    expect(props.openInstance).toHaveBeenLastCalledWith('job:bash-1')

    const settled = screen.getByRole('button', { name: /label-bash-2/ })
    fireEvent.keyDown(settled, { key: 'Enter' })
    expect(props.openInstance).toHaveBeenLastCalledWith('job:bash-2')
  })

  it('lists subagents and opens a tab on click', () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [] },
      subagentsByParent: { [SESSION]: catalog([
        { kind: 'child', id: 'session-child-1' as SessionId, activity: 'running', hasChildren: false, mode: 'continuable', label: '调研子代理' },
      ]) },
    }
    const props = panelProps(state)
    render(<ActivityPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /调研子代理/ }))
    expect(props.openInstance).toHaveBeenCalledExactlyOnceWith('session-child-1')
  })

  it('anchors to the parent while a subagent is opened in the conversation area', async () => {
    const state: ListState = {
      byId: {},
      currentAddress: { parentSessionId: SESSION, childSessionId: 'session-child-1' as SessionId, mode: 'continuable' },
      // The panel's own scope follows the child; the PARENT's catalog must show.
      jobsBySession: { 'session-child-1': [] },
      subagentsByParent: {
        'session-child-1': catalog([]),
        [SESSION]: catalog([
          { kind: 'child', id: 'session-child-1' as SessionId, activity: 'inactive', hasChildren: false, mode: 'continuable', label: '调研子代理' },
        ]),
      },
    }
    const props = panelProps(state)
    const view = render(<ActivityPanel {...props} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(view.container.textContent).toContain('调研子代理')
    // The addressed child's meta becomes the return control.
    fireEvent.click(screen.getByRole('button', { name: 'subagent.closeConversation' }))
    expect(props.closeFromConversation).toHaveBeenCalledExactlyOnceWith(SESSION)
  })

  it('renders the turn cohort above the earlier group', async () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [] },
      subagentsByParent: { [SESSION]: catalog([
        { kind: 'child', id: 'session-old' as SessionId, activity: 'inactive', hasChildren: false, mode: 'continuable', label: '旧代理' },
        { kind: 'child', id: 'session-now' as SessionId, activity: 'inactive', hasChildren: false, mode: 'one-shot', label: '本轮代理' },
      ]) },
    }
    const subagentOverview = vi.fn(async () => ({ ok: true as const, turnStartedAt: 1_000, children: [
      { id: 'session-old', running: false, lastActiveAt: 500 },
      { id: 'session-now', running: false, lastActiveAt: 1_200 },
    ] }))
    const view = render(<ActivityPanel {...panelProps(state, { subagentOverview })} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const text = view.container.textContent ?? ''
    expect(text).toContain('subagent.turn')
    expect(text).toContain('subagent.earlier')
    expect(text.indexOf('本轮代理')).toBeLessThan(text.indexOf('旧代理'))
  })

  it('shows the empty state when nothing runs', () => {
    const state: ListState = { byId: {}, currentAddress: undefined, jobsBySession: { [SESSION]: [] }, subagentsByParent: { [SESSION]: catalog([]) } }
    const view = render(<ActivityPanel {...panelProps(state)} />)
    expect(view.container.textContent).toContain('empty.title')
  })
})

describe('ActivityPanel instance route', () => {
  beforeEach(() => { vi.useFakeTimers(); embedCalls.length = 0 })
  afterEach(() => {
    cleanup()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.useRealTimers()
    vi.clearAllTimers()
  })

  const childId = 'session-child-1'

  const state = () => ({
    byId: {},
    currentAddress: undefined,
    jobsBySession: { [SESSION]: [] },
    subagentsByParent: { [SESSION]: catalog([
      { kind: 'child', id: childId as SessionId, activity: 'running', hasChildren: false, mode: 'continuable', label: '调研子代理' },
    ]) },
  })

  const embedCalls: unknown[][] = []
  const renderEmbedProp = () => Object.assign(
    (key: string, owner: unknown) => { embedCalls.push([key, owner]); return null },
    { subscribe: () => () => {}, version: () => 0 },
  )

  it('mounts the explicit child surface without copying transcript data', () => {
    const props = panelProps(state(), {}, { route: 'instance', activeInstanceId: childId })
    props.renderSlot = renderEmbedProp() as never
    render(<ActivityPanel {...props} />)
    expect(embedCalls.length).toBeGreaterThan(0)
    const [key, owner] = embedCalls[embedCalls.length - 1] as [string, Record<string, unknown>]
    expect(key).toBe('deepcreator.conversation.embed')
    expect(owner).toEqual({ childSessionId: childId })
  })

  it('keeps the jump action in the instance body instead of the Workbench header', () => {
    const contributeHeaderActions = vi.fn(() => () => undefined)
    const props = panelProps(state(), {}, { route: 'instance', activeInstanceId: childId })
    props.contributeHeaderActions = contributeHeaderActions
    props.renderSlot = renderEmbedProp() as never
    const view = render(<ActivityPanel {...props} />)
    expect(contributeHeaderActions).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'subagent.open' }))
    expect(props.openInConversation).toHaveBeenCalledExactlyOnceWith({
      parentSessionId: SESSION, childSessionId: childId, mode: 'continuable',
    })
    expect(props.showHome).toHaveBeenCalledOnce()
  })

  it('creates no polling timers while a running child remains visible', async () => {
    const props = panelProps(state(), {}, { route: 'instance', activeInstanceId: childId })
    props.renderSlot = renderEmbedProp() as never
    render(<ActivityPanel {...props} />)
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps an unlisted child readable but disables the jump', () => {
    const gone = state()
    gone.subagentsByParent[SESSION] = catalog([])
    const props = panelProps(gone, {}, { route: 'instance', activeInstanceId: childId })
    props.renderSlot = renderEmbedProp() as never
    const view = render(<ActivityPanel {...props} />)
    expect(view.container.textContent).toContain('subagent.gone')
    expect(embedCalls.at(-1)?.[1]).toEqual({ childSessionId: childId })
    expect(view.getByRole('button', { name: 'subagent.open' }).hasAttribute('disabled')).toBe(true)
  })

  it('releases the child surface while the document is hidden and remounts on return', () => {
    const props = panelProps(state(), {}, { route: 'instance', activeInstanceId: childId })
    props.renderSlot = renderEmbedProp() as never
    render(<ActivityPanel {...props} />)
    const visibleCalls = embedCalls.length

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(document.querySelector('[class*="embedBody"]')?.childElementCount).toBe(0)

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(embedCalls.length).toBeGreaterThan(visibleCalls)
  })
})

describe('ActivityPanel job instance route', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { cleanup(); vi.useRealTimers() })

  it('shows the complete command and official job facts without reading output', () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [job({
        id: 'bash-1', status: 'running', startedAt: Date.now() - 5_000,
        label: 'brew reinstall --build-from-source ffmpeg 2>&1 | tail -3',
      })] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const contributePanelInfo = vi.fn(() => () => undefined)
    const props = panelProps(state, {}, { route: 'instance', activeInstanceId: 'job:bash-1' })
    props.contributePanelInfo = contributePanelInfo
    const view = render(<ActivityPanel {...props} />)

    expect(view.getByText('brew reinstall --build-from-source ffmpeg 2>&1 | tail -3')).toBeTruthy()
    expect(view.container.textContent).toContain('job.id')
    expect(view.container.textContent).toContain('bash-1')
    expect(view.container.textContent).toContain('job.output.note')
    expect(contributePanelInfo).toHaveBeenCalledWith({
      tabLabels: { 'job:bash-1': 'brew reinstall --build-from-source ffmpeg 2>&1 | tail -3' },
    })
  })

  it('keeps Stop available in a live job tab and does not navigate elsewhere', async () => {
    const state: ListState = {
      byId: {},
      currentAddress: undefined,
      jobsBySession: { [SESSION]: [job({ id: 'bash-1', status: 'running', startedAt: Date.now() })] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const stopJob = vi.fn(async () => ({ ok: true as const }))
    const props = panelProps(state, { stopJob }, { route: 'instance', activeInstanceId: 'job:bash-1' })
    const view = render(<ActivityPanel {...props} />)
    fireEvent.click(view.getByRole('button', { name: 'stop' }))
    expect(stopJob).toHaveBeenCalledExactlyOnceWith(SESSION, 'bash-1')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(props.openInstance).not.toHaveBeenCalled()
  })

  it('keeps an opened tab explainable after the job leaves the official catalog', () => {
    const state: ListState = {
      byId: {}, currentAddress: undefined, jobsBySession: { [SESSION]: [] },
      subagentsByParent: { [SESSION]: catalog([]) },
    }
    const view = render(<ActivityPanel {...panelProps(state, {}, { route: 'instance', activeInstanceId: 'job:bash-9' })} />)
    expect(view.container.textContent).toContain('job.gone.title')
    expect(view.container.textContent).toContain('job.gone.body')
  })
})
