// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ReviewPanel, matchReviewFile } from '../src/client/Panels.tsx'
import { ReviewCacheController } from '../src/client/review-cache.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => {
  localStorage.clear()
  // jsdom has no scrollIntoView; the panel's top-focus scroll (open) and the
  // reveal tests both call it. The reveal test overrides this stub locally.
  Element.prototype.scrollIntoView = vi.fn()
})

const SID = 'session-1' as SessionId

const patches: Record<string, string> = {
  'src/a.ts': [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-const value = 1',
    '+const value = 2',
  ].join('\n'),
  'src/b.ts': [
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1 +1 @@',
    '-export const ready = false',
    '+export const ready = true',
  ].join('\n'),
}

const emptyChat = (): ConversationSnapshot => ({ nodes: [], turnEnds: new Map() }) as unknown as ConversationSnapshot

function sessionStub(initial: ConversationSnapshot = emptyChat()) {
  const listeners = new Set<() => void>()
  let current = initial
  return {
    session: {
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      getSnapshot: () => current,
    },
  }
}

function remoteMock() {
  return {
    review: {
      history: vi.fn().mockResolvedValue({
        ok: true,
        value: { ok: true, repositoryRoot: '/workspace', turns: [] },
      }),
      status: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', branch: 'main',
          files: [
            { path: 'src/a.ts', index: ' ', workingTree: 'M' },
            { path: 'src/b.ts', index: ' ', workingTree: 'M' },
          ],
        },
      }),
      checks: vi.fn().mockResolvedValue({
        ok: true, value: { ok: true, repositoryRoot: '/workspace', clean: true, output: '' },
      }),
      summary: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', scope: 'uncommitted', additions: 2, deletions: 2,
          files: [
            { path: 'src/a.ts', additions: 1, deletions: 1, binary: false },
            { path: 'src/b.ts', additions: 1, deletions: 1, binary: false },
          ],
        },
      }),
      diff: vi.fn(async (_sessionId: string, path: string) => ({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', path,
          layers: [{
            kind: 'working-tree',
            patch: patches[path],
            oldSource: { revision: 'index', text: path === 'src/a.ts' ? 'const value = 1' : 'export const ready = false' },
            newSource: { revision: 'worktree', text: path === 'src/a.ts' ? 'const value = 2' : 'export const ready = true' },
          }],
        },
      })),
    },
  }
}

/** Panel props carrying a real controller over the mocked data plane. */
function props(remote = remoteMock()): ComponentProps<typeof ReviewPanel> & { remote: ReturnType<typeof remoteMock> } {
  const controller = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
  return {
    controller,
    remote,
    sessionId: SID,
    route: 'home',
    tabs: [],
    typeId: 'review',
    openInstance: vi.fn(),
    activateInstance: vi.fn(),
    closeInstance: vi.fn(),
    showHome: vi.fn(),
    contributeHeaderActions: () => () => undefined,
    renderArtifact: () => null,
    t: (key: string) => key,
  } as ComponentProps<typeof ReviewPanel> & { remote: ReturnType<typeof remoteMock> }
}

describe('Review Panel file stream', () => {
  it('groups unresolved turns under a heading, sorts newest first, and keeps the trigger concise', async () => {
    let contribution: { left?: React.ReactNode } | undefined
    const remote = remoteMock()
    remote.review.history.mockResolvedValue({
      ok: true,
      value: {
        ok: true,
        repositoryRoot: '/workspace',
        turns: [
          { turn: 4, totalFiles: 1, remainingFiles: 1, state: 'active', undoable: false, files: [{ path: 'src/a.ts', state: 'pending' }] },
          { turn: 6, totalFiles: 1, remainingFiles: 0, state: 'committed', undoable: false, files: [{ path: 'src/a.ts', state: 'committed' }] },
          { turn: 5, totalFiles: 1, remainingFiles: 1, state: 'active', undoable: true, files: [{ path: 'src/b.ts', state: 'pending' }] },
        ],
      },
    })
    const input = props(remote)
    input.contributeHeaderActions = value => { contribution = value; return () => undefined }
    input.t = ((key: string, params?: Record<string, unknown>) => {
      if (key === 'review.scope.history') return '历史轮次'
      if (key === 'review.scope.turn') return `第 ${String(params?.turn)} 轮`
      return key
    }) as never
    render(<ReviewPanel {...input} />)

    type ScopeMenu = {
      props: {
        items: Array<{ id: string; type?: string; text?: string; label?: string }>
        onSelect: (id: string) => void
        anchor: { props: { children: Array<{ props?: { children?: string } }> } }
      }
    }
    await waitFor(() => {
      const menu = contribution?.left as unknown as ScopeMenu | undefined
      expect(menu?.props.items.slice(3).map(item => item.type === 'label' ? `${item.type}:${item.text}` : `${item.id}:${item.label}`)).toEqual([
        'label:历史轮次',
        'turn:5:第 5 轮',
        'turn:4:第 4 轮',
      ])
    })

    act(() => { (contribution?.left as unknown as ScopeMenu).props.onSelect('turn:5') })
    await waitFor(() => {
      const menu = contribution?.left as unknown as ScopeMenu
      expect(menu.props.anchor.props.children[0]?.props?.children).toBe('第 5 轮')
    })
  })

  it('preheats visible top files; opening expands all and never refetches cached files', { timeout: 15000 }, async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)

    // The controller prefetched both files before any click.
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    expect(input.remote.review.checks).not.toHaveBeenCalled()
    const first = view.getByRole('button', { name: /src\/a\.ts/ })
    const second = view.getByRole('button', { name: /src\/b\.ts/ })

    // The status bar carries the overall diff totals once the warms are ready
    // (a.ts: +1 -1, b.ts: +1 -1 across the staged layer's single files).
    await waitFor(() => {
      const status = view.container.querySelector('div[class*="reviewStatus"]')
      expect(status?.textContent).toContain('+2')
      expect(status?.textContent).toContain('-2')
    }, { timeout: 5000 })

    // Opening the panel expands every file; both headers carry prefetched counts.
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(second.getAttribute('aria-expanded')).toBe('true')
    // The body fills in after the pause window (batch/restore mounts go
    // through the body-fill queue, not synchronously); jsdom frame timing can
    // stretch that, so wait with a generous timeout.
    await waitFor(() => { expect(view.container.textContent).toContain('const value = 2') }, { timeout: 5000 })

    // Collapse and re-expand the second file: the cached parse renders without
    // another fetch.
    fireEvent.click(second)
    expect(second.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(second)
    await waitFor(() => { expect(second.closest('article')?.textContent).toContain('export const ready = true') })
    expect(input.remote.review.diff).toHaveBeenCalledTimes(2)

    // Same for the first file.
    fireEvent.click(first)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(first)
    await waitFor(() => { expect(first.closest('article')?.textContent).toContain('const value = 2') })
    expect(input.remote.review.diff).toHaveBeenCalledTimes(2)
  })

  it('one header action toggles every file between expand-all and collapse-all', async () => {
    // Header actions render in the shell's Header, not the panel body: the
    // test drives the captured contribution directly (labels, order, and the
    // click handler) and asserts the effect on the file rows.
    let contribution: { right?: React.ReactNode } | undefined
    const input = props()
    input.contributeHeaderActions = value => { contribution = value; return () => undefined }
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })

    type HeaderButton = { props: { label: string; disabled?: boolean; onClick: () => void } }
    const headerButtons = (): HeaderButton[] | undefined =>
      (contribution?.right as unknown as { props?: { children?: HeaderButton[] } } | undefined)?.props?.children
    const action = () => headerButtons()?.[0]?.props

    // The restore expansion lands after prefetch: wait for the contribution
    // to become the collapse-all state.
    await waitFor(() => { expect(action()?.label).toBe('review.collapseAll') })
    expect(headerButtons()?.map(button => button.props.label)).toEqual(['review.collapseAll', 'refresh'])
    expect(action()?.disabled).toBeFalsy()

    act(() => { action()?.onClick() })
    await waitFor(() => {
      expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('false')
      expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('false')
    })
    await waitFor(() => { expect(action()?.label).toBe('review.expandAll') })

    // Expand-all reuses the warm caches without refetching.
    const before = input.remote.review.diff.mock.calls.length
    act(() => { action()?.onClick() })
    await waitFor(() => {
      expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
      expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    })
    expect(input.remote.review.diff.mock.calls.length).toBe(before)
  })

  it('keeps file headers sticky inside the single scrolling viewport', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-tools/src/client/Panels.module.css'), 'utf8')

    expect(stylesheet).toMatch(/\.reviewBody\s*\{[^}]*overflow:\s*visible;/)
    expect(stylesheet).toMatch(/\.reviewFileHeader\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/)
    expect(stylesheet).not.toMatch(/\.reviewBody\s*\{[^}]*grid-template-columns:/)
  })

  it('preserves the path tail with a left-edge fade in file headers', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(view.getByRole('button', { name: /src\/a\.ts/ })).toBeDefined() })

    const path = view.container.querySelector('[data-overflow-fade="left"]')
    expect(path?.textContent).toBe('src/a.ts')
    expect(path?.getAttribute('title')).toBe('src/a.ts')
  })

  it('keeps Review surfaces on app chrome instead of the selected code-theme background', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-tools/src/client/Panels.module.css'), 'utf8')

    expect(stylesheet).toMatch(/\.review\s*\{[^}]*--dsh-review-surface:\s*var\(--dsw-alias-bg-base\);/)
    expect(stylesheet).toMatch(/body\[data-ds-dark-theme\][^}]*\.review\s*\{[^}]*--dsh-review-surface:\s*var\(--dsw-specific-sidebar-fill\);/)
    expect(stylesheet).toContain('--dsw-diff-fold-bg: color-mix(in srgb, var(--dsw-alias-label-primary) 2.5%, var(--dsh-review-surface))')
    expect(stylesheet).not.toContain('--ds-code-background')
    expect(stylesheet).not.toContain('--ds-code-foreground')
  })

  it('unmounts a collapsed body while preserving its fetched cache for re-expansion', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    // Restore expands the first file; the body fills after the pause window
    // (generous timeout: jsdom frame timing can stretch it).
    await waitFor(() => { expect(view.container.textContent).toContain('const value = 2') }, { timeout: 5000 })
    const first = view.getByRole('button', { name: /src\/a\.ts/ })

    fireEvent.click(first)
    expect(first.closest('article')?.textContent).not.toContain('const value = 2')
    const fetches = input.remote.review.diff.mock.calls.length

    fireEvent.click(first)
    await waitFor(() => { expect(first.getAttribute('aria-expanded')).toBe('true') })
    expect(input.remote.review.diff.mock.calls.length).toBe(fetches)
  })

  it('expands, re-fetches, and scrolls to the revealed file from an absolute target', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    expect(input.remote.review.status).toHaveBeenCalledTimes(1)

    view.rerender(<ReviewPanel {...input} reveal={{ target: '/workspace/src/b.ts', nonce: 1 }} />)

    await waitFor(() => { expect(input.remote.review.status).toHaveBeenCalledTimes(2) })
    const second = view.getByRole('button', { name: /src\/b\.ts/ })
    expect(second.getAttribute('aria-expanded')).toBe('true')
    // The live expansion survives a reveal instead of resetting.
    expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    // The focus wants current content: exactly one fresh re-fetch of b.
    expect(input.remote.review.diff).toHaveBeenLastCalledWith('session-1', 'src/b.ts', 'uncommitted')
    expect(input.remote.review.diff).toHaveBeenCalledTimes(3)
    // The reveal scroll lands last: the open's top-focus scroll preceded it.
    // Heavy renders (multi-theme token payloads) can stretch the reveal's
    // expansion frame, so wait until ITS scroll is the latest one.
    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalled()
      const latest = scrollIntoView.mock.instances[scrollIntoView.mock.instances.length - 1] as HTMLElement
      expect(latest.dataset.reviewPath).toBe('src/b.ts')
    })
    const last = scrollIntoView.mock.instances[scrollIntoView.mock.instances.length - 1] as HTMLElement
    expect(last.dataset.reviewPath).toBe('src/b.ts')
    expect(view.queryByText('review.missedFile')).toBeNull()
  })

  it('reports a miss and keeps the live expansion when the target has no change', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    const first = await waitFor(() => view.getByRole('button', { name: /src\/a\.ts/ }))

    view.rerender(<ReviewPanel {...input} reveal={{ target: '/workspace/src/gone.ts', nonce: 1 }} />)

    await waitFor(() => { expect(view.getByText('review.missedFile')).toBeTruthy() })
    expect(view.getByText('review.missedFile').parentElement?.querySelector('[data-file-icon="typescript"]')).not.toBeNull()
    expect(view.container.textContent).toContain('/workspace/src/gone.ts')
    expect(first.getAttribute('aria-expanded')).toBe('true')
  })

  it('clears a stale miss on scope selection and renders the pending scope as loading', async () => {
    let contribution: { left?: React.ReactNode } | undefined
    const input = props()
    input.contributeHeaderActions = value => { contribution = value; return () => undefined }
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })

    view.rerender(<ReviewPanel {...input} reveal={{ target: '/workspace/src/gone.ts', nonce: 1 }} />)
    await waitFor(() => { expect(view.getByText('review.missedFile')).toBeTruthy() })

    let release: ((value: unknown) => void) | undefined
    input.remote.review.status.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    type ScopeMenu = { props: { onSelect: (id: string) => void } }
    const menu = contribution?.left as unknown as ScopeMenu
    act(() => { menu.props.onSelect('staged') })

    expect(view.queryByText('review.missedFile')).toBeNull()
    expect(view.getByText('loading')).toBeTruthy()
    release?.({
      ok: true,
      value: { ok: true, repositoryRoot: '/workspace', branch: 'main', files: [] },
    })
    await waitFor(() => { expect(view.getByText('review.clean')).toBeTruthy() })
  })

  it('shows a scope-load error without converting it into a missing-file warning', async () => {
    let contribution: { left?: React.ReactNode } | undefined
    const input = props()
    input.contributeHeaderActions = value => { contribution = value; return () => undefined }
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    input.remote.review.status.mockRejectedValueOnce(new Error('status unavailable'))
    type ScopeMenu = { props: { onSelect: (id: string) => void } }

    act(() => { (contribution?.left as unknown as ScopeMenu).props.onSelect('staged') })

    await waitFor(() => { expect(view.getByText('status unavailable')).toBeTruthy() })
    expect(view.getByText('review.loadFailed')).toBeTruthy()
    expect(view.queryByText('review.missedFile')).toBeNull()
  })

  it('a visibility transition refreshes status silently and keeps caches and expansion', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })

    view.rerender(<ReviewPanel {...input} visible={false} />)
    view.rerender(<ReviewPanel {...input} visible={true} />)

    await waitFor(() => { expect(input.remote.review.status).toHaveBeenCalledTimes(2) })
    // Unchanged status keeps every cache: no diff refetch, expansion intact.
    expect(input.remote.review.diff).toHaveBeenCalledTimes(2)
    expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('lets an explicit open presentation win the hidden-to-visible refresh and expands every file', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} visible={false} />)
    await waitFor(() => { expect(input.remote.review.status).toHaveBeenCalled() })
    expect(input.remote.review.diff).not.toHaveBeenCalled()

    view.rerender(<ReviewPanel
      {...input}
      visible
      reveal={{ parameters: { scope: 'unstaged', expand: 'all' }, nonce: 1 }}
    />)

    await waitFor(() => {
      expect(input.remote.review.status).toHaveBeenLastCalledWith('session-1', 'unstaged')
      expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
      expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('opens at the full top window and gives a targeted reveal its own bidirectional window', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    // Opening = expand-all, top of the list.
    expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')

    // A reveal-driven open starts at the target; earlier/later files sit
    // behind independent loading boundaries instead of inflating scrollHeight.
    view.unmount()
    input.controller.dispose()
    const next = props()
    const revealed = render(<ReviewPanel
      {...next}
      reveal={{ target: '/workspace/src/b.ts', parameters: { scope: 'turn', turn: '5', expand: 'all' }, nonce: 1 }}
    />)
    await waitFor(() => { expect(next.remote.review.diff).toHaveBeenCalledTimes(2) })
    expect(next.remote.review.status).toHaveBeenLastCalledWith('session-1', { turn: 5 })
    expect(revealed.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    expect(revealed.container.querySelector('[data-review-boundary="before"]')).not.toBeNull()
    await waitFor(() => { expect(revealed.container.textContent).toContain('export const ready = true') })
  })

  it('fully expands the requested scope for card and shared Review-control presentations', async () => {
    const fromCard = props()
    const cardView = render(<ReviewPanel
      {...fromCard}
      reveal={{ parameters: { scope: 'turn', turn: '5', expand: 'all' }, nonce: 1 }}
    />)
    await waitFor(() => {
      expect(fromCard.remote.review.status).toHaveBeenLastCalledWith('session-1', { turn: 5 })
      expect(cardView.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
      expect(cardView.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    })
    cardView.unmount()
    fromCard.controller.dispose()

    const fromHeader = props()
    const headerView = render(<ReviewPanel
      {...fromHeader}
      reveal={{ parameters: { scope: 'unstaged', expand: 'all' }, nonce: 2 }}
    />)
    await waitFor(() => {
      expect(fromHeader.remote.review.status).toHaveBeenLastCalledWith('session-1', 'unstaged')
      expect(headerView.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
      expect(headerView.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('fully expands after a manual scope selection', async () => {
    let contribution: { left?: React.ReactNode } | undefined
    const input = props()
    input.contributeHeaderActions = value => { contribution = value; return () => undefined }
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    fireEvent.click(view.getByRole('button', { name: /src\/a\.ts/ }))
    fireEvent.click(view.getByRole('button', { name: /src\/b\.ts/ }))
    expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('false')
    expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('false')

    type ScopeMenu = { props: { onSelect: (id: string) => void } }
    act(() => { (contribution?.left as unknown as ScopeMenu).props.onSelect('staged') })
    await waitFor(() => {
      expect(input.remote.review.status).toHaveBeenLastCalledWith('session-1', 'staged')
      expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
      expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    })
  })

  it('gates 500 files in settled two-screen batches and expands both directions around a reveal', { timeout: 20000 }, async () => {
    type ObserverRecord = {
      margin: string
      targets: Set<Element>
      trigger: (target: Element, isIntersecting: boolean) => void
    }
    const observers: ObserverRecord[] = []
    class TestIntersectionObserver {
      readonly root: Element | Document | null
      readonly rootMargin: string
      readonly thresholds: readonly number[] = [0]
      private readonly callback: IntersectionObserverCallback
      readonly targets = new Set<Element>()
      constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
        this.callback = callback
        this.root = options.root ?? null
        this.rootMargin = options.rootMargin ?? '0px'
        observers.push({
          margin: this.rootMargin,
          targets: this.targets,
          trigger: (target, isIntersecting) => {
            this.callback([{ target, isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
          },
        })
      }
      observe(target: Element) { this.targets.add(target) }
      unobserve(target: Element) { this.targets.delete(target) }
      disconnect() { this.targets.clear() }
      takeRecords(): IntersectionObserverEntry[] { return [] }
    }
    vi.stubGlobal('IntersectionObserver', TestIntersectionObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => { callback(performance.now() + 1_000) }, 0))
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => { window.clearTimeout(handle) })

    const paths = Array.from({ length: 500 }, (_value, index) => `src/f${String(index + 1).padStart(3, '0')}.ts`)
    const remote = remoteMock()
    remote.review.status.mockResolvedValue({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', branch: 'main',
        files: paths.map(path => ({ path, index: ' ', workingTree: 'M' })),
      },
    })
    remote.review.summary.mockResolvedValue({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', scope: 'uncommitted', additions: 500, deletions: 500,
        files: paths.map(path => ({ path, additions: 1, deletions: 1, binary: false })),
      },
    })
    remote.review.diff.mockImplementation(async (_sessionId: string, path: string) => ({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', path,
        layers: [{
          kind: 'working-tree', patch: [
            `diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -1 +1 @@', '-old', '+new',
          ].join('\n'),
          oldSource: { revision: 'index', text: 'old' },
          newSource: { revision: 'worktree', text: 'new' },
        }],
      },
    }))
    const input = props(remote)
    const view = render(<ReviewPanel {...input} />)

    await waitFor(() => { expect(view.container.querySelectorAll('[data-review-path]')).toHaveLength(6) })
    await waitFor(() => {
      expect([...view.container.querySelectorAll('[data-review-path]')].every(row => row.querySelector('button')?.getAttribute('aria-expanded') === 'true')).toBe(true)
    })
    await waitFor(() => { expect(remote.review.diff).toHaveBeenCalledTimes(6) })

    const afterGate = await waitFor(() => {
      const observer = observers.find(item => item.margin === '0px 0px 200% 0px')
      expect(observer).toBeDefined()
      return observer as ObserverRecord
    })
    const afterBoundary = view.container.querySelector('[data-review-boundary="after"]') as HTMLElement
    act(() => { afterGate.trigger(afterBoundary, true) })
    expect(view.container.querySelectorAll('[data-review-path]')).toHaveLength(6)
    expect(view.container.querySelector('[data-review-boundary="after"]')?.textContent).toContain('loading')
    // The exact row count follows the measured scroll-root height; regardless
    // of that test-host geometry, the range grows only after the whole batch
    // settles and remains far smaller than the 500-file repository.
    await waitFor(() => { expect(remote.review.diff.mock.calls.length).toBeGreaterThan(6) })
    await waitFor(() => { expect(view.container.querySelectorAll('[data-review-path]').length).toBeGreaterThan(6) })
    expect(view.container.querySelectorAll('[data-review-path]').length).toBeLessThan(100)

    view.rerender(<ReviewPanel
      {...input}
      reveal={{ target: '/workspace/src/f400.ts', parameters: { scope: 'uncommitted', expand: 'all' }, nonce: 1 }}
    />)
    await waitFor(() => { expect(remote.review.diff).toHaveBeenCalledWith('session-1', 'src/f400.ts', 'uncommitted') })
    await waitFor(() => { expect(view.container.querySelectorAll('[data-review-path]')).toHaveLength(1) })
    const row400 = view.container.querySelector('[data-review-path="src/f400.ts"]') as HTMLElement
    await waitFor(() => { expect(row400.querySelector('div[class*="reviewFileContent"]')).not.toBeNull() })
    expect(view.container.querySelector('[data-review-boundary="before"]')).not.toBeNull()
    expect(view.container.querySelector('[data-review-boundary="after"]')).not.toBeNull()

    const beforeBoundaryAtReveal = view.container.querySelector('[data-review-boundary="before"]') as HTMLElement
    const afterBoundaryAtReveal = view.container.querySelector('[data-review-boundary="after"]') as HTMLElement
    const beforeGate = await waitFor(() => {
      const observer = observers.findLast(item => item.margin === '200% 0px 0px 0px' && item.targets.has(beforeBoundaryAtReveal))
      expect(observer).toBeDefined()
      return observer as ObserverRecord
    })
    const nextAfterGate = await waitFor(() => {
      const observer = observers.findLast(item => item.margin === '0px 0px 200% 0px' && item.targets.has(afterBoundaryAtReveal))
      expect(observer).toBeDefined()
      return observer as ObserverRecord
    })
    act(() => {
      beforeGate.trigger(beforeBoundaryAtReveal, true)
      nextAfterGate.trigger(afterBoundaryAtReveal, true)
    })
    expect(view.container.querySelectorAll('[data-review-path]')).toHaveLength(1)
    await waitFor(() => {
      const current = [...view.container.querySelectorAll<HTMLElement>('[data-review-path]')]
        .map(row => row.dataset.reviewPath ?? '')
      expect(current.some(path => path < 'src/f400.ts')).toBe(true)
      expect(current.some(path => path > 'src/f400.ts')).toBe(true)
    })
    const revealedPaths = [...view.container.querySelectorAll<HTMLElement>('[data-review-path]')]
      .map(row => row.dataset.reviewPath ?? '')
    expect(revealedPaths.some(path => path < 'src/f400.ts')).toBe(true)
    expect(revealedPaths.some(path => path > 'src/f400.ts')).toBe(true)
    input.controller.dispose()
  })
})

describe('matchReviewFile', () => {
  const files = [
    { path: 'src/a.ts', index: ' ', workingTree: 'M' },
    { path: 'pkg/renamed.ts', oldPath: 'pkg/original.ts', index: 'R', workingTree: ' ' },
  ]

  it('matches exact identities including a rename old path', () => {
    expect(matchReviewFile(files, 'src/a.ts')).toBe('src/a.ts')
    expect(matchReviewFile(files, 'pkg/original.ts')).toBe('pkg/renamed.ts')
  })

  it('matches either-side suffixes across absolute and repository-relative forms', () => {
    expect(matchReviewFile(files, '/Users/dev/workspace/src/a.ts')).toBe('src/a.ts')
    expect(matchReviewFile(files, 'src\\a.ts')).toBe('src/a.ts')
    expect(matchReviewFile(files, 'workspace/src/a.ts/')).toBe('src/a.ts')
  })

  it('returns undefined when nothing matches', () => {
    expect(matchReviewFile(files, 'src/other.ts')).toBeUndefined()
    expect(matchReviewFile(files, '')).toBeUndefined()
  })
})
