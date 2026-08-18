// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { ReviewPanel, matchReviewFile } from '../src/client/Panels.tsx'
import { ReviewCacheController } from '../src/client/review-cache.ts'

afterEach(cleanup)
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
  it('warms every file in the background; opening expands all and never refetches warmed files', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)

    // The controller prefetched both files before any click.
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    expect(input.remote.review.checks).not.toHaveBeenCalled()
    const first = view.getByRole('button', { name: /src\/a\.ts/ })
    const second = view.getByRole('button', { name: /src\/b\.ts/ })

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

  it('keeps expanded content mounted across collapse, so re-expanding never rebuilds', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    // Restore expands the first file; the body fills after the pause window
    // (generous timeout: jsdom frame timing can stretch it).
    await waitFor(() => { expect(view.container.textContent).toContain('const value = 2') }, { timeout: 5000 })
    const first = view.getByRole('button', { name: /src\/a\.ts/ })

    fireEvent.click(first)
    // Collapsing hides the content instead of unmounting it: the body stays
    // in the DOM behind aria-hidden, so the next expand is a pure CSS flip.
    const hidden = view.container.querySelector('[data-review-path="src/a.ts"] > div[aria-hidden="true"]')
    expect(hidden).not.toBeNull()
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
    expect(input.remote.review.diff).toHaveBeenLastCalledWith('session-1', 'src/b.ts')
    expect(input.remote.review.diff).toHaveBeenCalledTimes(3)
    await waitFor(() => { expect(scrollIntoView).toHaveBeenCalled() })
    // The reveal scroll lands last: the open's top-focus scroll preceded it.
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
    expect(view.container.textContent).toContain('/workspace/src/gone.ts')
    expect(first.getAttribute('aria-expanded')).toBe('true')
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

  it('opening the panel expands every file; a reveal-driven open keeps its focus', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    // Opening = expand-all, top of the list.
    expect(view.getByRole('button', { name: /src\/a\.ts/ }).getAttribute('aria-expanded')).toBe('true')
    expect(view.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')

    // A reveal-driven open expands the target only (no expand-all reset).
    view.unmount()
    input.controller.dispose()
    const next = props()
    const revealed = render(<ReviewPanel {...next} reveal={{ target: '/workspace/src/b.ts', nonce: 1 }} />)
    await waitFor(() => { expect(next.remote.review.diff).toHaveBeenCalledTimes(2) })
    expect(revealed.getByRole('button', { name: /src\/b\.ts/ }).getAttribute('aria-expanded')).toBe('true')
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
