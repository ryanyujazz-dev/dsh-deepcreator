// @vitest-environment jsdom
// DiffBlock: the per-file cards (path header, removed block, added block),
// same-file hunk composition, the `+A -R · N file(s)` footer and
// its singular/plural, context and head/tail inline FoldRows, the
// empty-diffs null render, and the copy control writing the prefixed diff text
// on both the accepted and the refused clipboard paths. writeClipboard's own
// return contract is pinned in terminal-block.spec.tsx (the shared return contract), so
// only its DOM consequence is asserted here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  buildDiffHunkModel, DiffBlock, parseUnifiedDiff, type DiffHunk,
} from '../src/index.ts'

afterEach(cleanup)

beforeEach(() => {
  vi.useRealTimers()
})

/** The rendered body rows, one string per visible line (CSS-module class prefix). */
function bodyRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_line_"]')].map(row => row.textContent ?? '')
}

/** Only the changed rows (add/del), excluding the path header and gap chrome. */
function changeRows(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-diff-row="del"], [data-diff-row="add"]')]
    .map(row => row.lastElementChild?.textContent ?? '')
}

/** `count` numbered added lines as one hunk's newText. */
function added(count: number): string {
  return Array.from({ length: count }, (_v, i) => `line ${i + 1}`).join('\n')
}

describe('DiffBlock structure', () => {
  it('uses the shared conversation-card surface while Review reveals its owning panel', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-primitives/src/DiffBlock.module.css'), 'utf8')

    expect(stylesheet).toMatch(/\.hunk\s*\{[^}]*background:\s*var\(--dsw-specific-sidebar-fill\)/)
    expect(stylesheet).toMatch(/\.review\s+\.hunk\s*\{[^}]*background:\s*transparent;/)
    expect(stylesheet).toMatch(/\.rows\s*\{[^}]*max-height:\s*var\(--dsl-diff-rows-max-height, none\);[^}]*overflow-y:\s*auto;/s)
  })

  it('advances absolute old/new line numbers independently and marks changed words', () => {
    const model = buildDiffHunkModel({
      path: 'a.ts', oldStart: 40, newStart: 40,
      oldText: 'const stable = true\nconst value = "old"',
      newText: 'const stable = true\nconst value = "new"',
    })
    expect(model.rows.map(row => [row.kind, row.oldLineNo, row.newLineNo])).toEqual([
      ['context', 40, 40], ['del', 41, null], ['add', null, 41],
    ])
    expect(model.rows[1]?.marks.length).toBeGreaterThan(0)
    expect(model.rows[2]?.marks.length).toBeGreaterThan(0)
  })

  it('exposes change semantics and absolute line numbers to screen readers', () => {
    render(<DiffBlock diffs={[{ path: 'a.ts', oldStart: 40, newStart: 40, oldText: 'old', newText: 'new' }]} />)
    expect(screen.getByRole('listitem', { name: '删除第 40 行：old' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: '新增第 40 行：new' })).toBeTruthy()
  })

  it('skips word refinement for one replacement block over the performance limit', () => {
    const oldText = Array.from({ length: 50 }, (_value, index) => `old-${index}-${'x'.repeat(40)}`).join('\n')
    const newText = Array.from({ length: 50 }, (_value, index) => `new-${index}-${'y'.repeat(40)}`).join('\n')
    const model = buildDiffHunkModel({ path: 'large.ts', oldText, newText })
    expect(model.rows.filter(row => row.kind !== 'context').every(row => row.marks.length === 0)).toBe(true)
  })

  it('parses unified hunk starts, rename paths, and binary state', () => {
    const files = parseUnifiedDiff([
      'diff --git a/old.ts b/new.ts',
      'similarity index 80%',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/old.ts',
      '+++ b/new.ts',
      '@@ -10,2 +12,2 @@',
      '-const oldValue = 1',
      '+const newValue = 2',
      ' context',
      '',
      'diff --git a/image.png b/image.png',
      'Binary files a/image.png and b/image.png differ',
    ].join('\n'))
    expect(files[0]).toMatchObject({ oldPath: 'old.ts', path: 'new.ts', added: 1, removed: 1 })
    expect(files[0]?.hunks[0]).toMatchObject({ oldStart: 10, newStart: 12 })
    expect(files[1]).toMatchObject({ path: 'image.png', binary: true })
  })

  it('renders a create as a path header and an added block (no removed side)', () => {
    const diffs: DiffHunk[] = [{ path: 'notes/new.txt', oldText: null, newText: 'hello\nworld' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('notes/new.txt')).toBeTruthy()
    // No removed rows: both change lines are added.
    expect(changeRows(container)).toEqual(['hello', 'world'])
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(0)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(2)
  })

  it('treats the file header as a tail-preserving path title', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'packages/client/src/chat.tsx', oldText: 'a', newText: 'b' }]} />)
    const title = container.querySelector('[data-overflow-fade="left"]')
    expect(title?.textContent).toBe('packages/client/src/chat.tsx')
    expect(title?.getAttribute('title')).toBe('packages/client/src/chat.tsx')
  })

  it('renders an edit as a removed block above an added block', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'old', newText: 'new' }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_del_"]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(1)
    expect(changeRows(container)).toEqual(['old', 'new'])
  })

  it('composes distant hunks from one file into one file card and one aggregated header', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[data-diff-file]').length).toBe(1)
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(1)
    expect(screen.getByText('+2')).toBeTruthy()
    expect(screen.getByText('-2')).toBeTruthy()
  })

  it('opens a new file with its own path header', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'x', newText: 'y' },
      { path: 'b.ts', oldText: 'p', newText: 'q' },
    ]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(container.querySelectorAll('[class*="_path_"]').length).toBe(2)
    expect(container.querySelectorAll('[data-diff-file]').length).toBe(2)
  })

  it('renders nothing for empty diffs', () => {
    const { container } = render(<DiffBlock diffs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('treats a trailing newline as a terminator, not an extra blank line', () => {
    // A create whose newText ends in a newline is one added line, not two, and
    // the footer counts one — the phantom `+ ` empty line the naive split drew.
    const { container } = render(<DiffBlock diffs={[{ path: 'n.txt', oldText: null, newText: 'hello\n' }]} />)
    expect(changeRows(container)).toEqual(['hello'])
    expect(screen.getByText('└ +1 -0 · 1 file')).toBeTruthy()
  })

  it('renders a full deletion as removed-only with no phantom added line', () => {
    // newText '' is zero added lines: an empty string must contribute nothing.
    const { container } = render(<DiffBlock diffs={[{ path: 'gone.ts', oldText: 'a\nb', newText: '' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(0)
    expect(screen.getByText('└ +0 -2 · 1 file')).toBeTruthy()
  })

  it('keeps a genuine interior blank line', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x\n\ny' }]} />)
    expect(container.querySelectorAll('[class*="_add_"]').length).toBe(3)
  })
})

describe('DiffBlock footer', () => {
  it('counts added and removed lines and one file', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: 'a\nb', newText: 'c' }]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +1 -2 · 1 file')).toBeTruthy()
  })

  it('pluralizes the distinct-file count', () => {
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: null, newText: 'x' },
      { path: 'b.ts', oldText: null, newText: 'y' },
    ]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.getByText('└ +2 -0 · 2 files')).toBeTruthy()
  })
})

describe('DiffBlock context folding', () => {
  it('never folds changed rows behind the general line cap', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(24) }]
    const { container } = render(<DiffBlock diffs={diffs} />)
    expect(screen.queryByRole('button', { name: /展开 \d+ 行/ })).toBeNull()
    expect(bodyRows(container)).toHaveLength(24)
  })

  // Rendering 2k virtualized rows is the heaviest case in this file; under the
  // parallel suite it needs far more than the 5s default, so give it its own.
  it('bounds mounted rows for a huge changed hunk', { timeout: 15_000 }, () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'huge.ts', oldText: null, newText: added(2_000) }]} variant="review" />)
    expect(container.querySelector('[data-diff-virtual-rows]')).toBeTruthy()
    const mounted = container.querySelectorAll('[data-diff-row]').length
    expect(mounted).toBeGreaterThan(0)
    expect(mounted).toBeLessThan(200)
  })

  it('keeps ordinary changed hunks on the lightweight row path', () => {
    const { container } = render(<DiffBlock diffs={[{ path: 'ordinary.ts', oldText: null, newText: added(120) }]} variant="review" />)
    expect(container.querySelector('[data-diff-virtual-rows]')).toBeNull()
    expect(container.querySelectorAll('[data-diff-row]')).toHaveLength(120)
  })

  it('shows no expand control at or under the cap', () => {
    const diffs: DiffHunk[] = [{ path: 'a.ts', oldText: null, newText: added(4) }]
    render(<DiffBlock diffs={diffs} />)
    expect(screen.queryByRole('button', { name: /展开 \d+ 行/ })).toBeNull()
  })

  it('folds a long context run in place and expands only that FoldRow', () => {
    const stable = Array.from({ length: 20 }, (_value, index) => `stable ${index + 1}`).join('\n')
    const { container } = render(<DiffBlock diffs={[{ path: 'stable.ts', oldText: stable, newText: stable }]} />)
    const toggle = screen.getByRole('button', { name: '展开 14 行' })

    expect(bodyRows(container)).toHaveLength(6)
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: '展开 14 行' })).toBeNull()
    expect(bodyRows(container)).toHaveLength(20)
  })

  it('reports expanded context folds and re-folds them on a reset signal', () => {
    const stable = Array.from({ length: 20 }, (_value, index) => `stable ${index + 1}`).join('\n')
    const expandedFolds = vi.fn()
    const { rerender } = render(
      <DiffBlock diffs={[{ path: 'stable.ts', oldText: stable, newText: stable }]} onFoldStateChange={expandedFolds} />,
    )
    expect(expandedFolds).toHaveBeenLastCalledWith(0)
    fireEvent.click(screen.getByRole('button', { name: '展开 14 行' }))
    expect(expandedFolds).toHaveBeenLastCalledWith(1)
    expect(screen.queryByRole('button', { name: '展开 14 行' })).toBeNull()

    rerender(
      <DiffBlock diffs={[{ path: 'stable.ts', oldText: stable, newText: stable }]} foldResetSignal={1} onFoldStateChange={expandedFolds} />,
    )
    expect(screen.getByRole('button', { name: '展开 14 行' })).toBeTruthy()
    expect(expandedFolds).toHaveBeenLastCalledWith(0)
  })

  it('restores controlled fold keys after the heavy body unmounts', () => {
    const stable = Array.from({ length: 20 }, (_value, index) => `stable ${index + 1}`).join('\n')
    function Harness() {
      const [shown, setShown] = useState(true)
      const [keys, setKeys] = useState<ReadonlySet<string>>(new Set())
      return <>
        <button type="button" onClick={() => { setShown(value => !value) }}>body</button>
        {shown && <DiffBlock
          diffs={[{ path: 'stable.ts', oldText: stable, newText: stable }]}
          expandedFoldKeys={keys}
          onExpandedFoldKeysChange={setKeys}
        />}
      </>
    }
    const { container } = render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '展开 14 行' }))
    fireEvent.click(screen.getByRole('button', { name: 'body' }))
    fireEvent.click(screen.getByRole('button', { name: 'body' }))

    expect(screen.queryByRole('button', { name: '展开 14 行' })).toBeNull()
    expect(bodyRows(container)).toContainEqual(expect.stringContaining('stable 10'))
  })

  it('reconstructs Review head, inter-hunk, and tail gaps as local FoldRows', () => {
    const oldLines = Array.from({ length: 30 }, (_value, index) => `line ${index + 1}`)
    const newLines = [...oldLines]
    newLines[4] = 'line 5 changed'
    newLines[24] = 'line 25 changed'
    const oldSource = `${oldLines.join('\n')}\n`
    const newSource = `${newLines.join('\n')}\n`
    const diffs: DiffHunk[] = [
      {
        path: 'review.ts', oldStart: 3, newStart: 3,
        oldText: oldLines.slice(2, 7).join('\n'), newText: newLines.slice(2, 7).join('\n'),
        oldSource, newSource,
      },
      {
        path: 'review.ts', oldStart: 23, newStart: 23,
        oldText: oldLines.slice(22, 27).join('\n'), newText: newLines.slice(22, 27).join('\n'),
        oldSource, newSource,
      },
    ]
    const { container } = render(<DiffBlock diffs={diffs} variant="review" showPath={false} showFooter={false} />)

    expect(screen.getByRole('button', { name: '展开 2 行' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开 15 行' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开 3 行' })).toBeTruthy()
    expect(container.textContent).not.toContain('line 12')

    fireEvent.click(screen.getByRole('button', { name: '展开 15 行' }))
    expect(screen.queryByRole('button', { name: '展开 15 行' })).toBeNull()
    expect(container.textContent).toContain('line 12')
    expect(screen.getByRole('button', { name: '展开 2 行' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开 3 行' })).toBeTruthy()
  })

  it('loads full Review source only when an omitted-context fold opens', async () => {
    const source = Array.from({ length: 20 }, (_value, index) => `line ${index + 1}`).join('\n')
    const loadSource = vi.fn().mockResolvedValue(source)
    const { container } = render(<DiffBlock
      diffs={[{
        path: 'lazy.ts', oldStart: 10, newStart: 10,
        oldText: 'old value', newText: 'new value',
        oldLineCount: 20, newLineCount: 20,
      }]}
      variant="review"
      showPath={false}
      showFooter={false}
      loadSource={loadSource}
    />)

    expect(loadSource).not.toHaveBeenCalled()
    expect(container.textContent).not.toContain('line 1')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '展开 9 行' })) })
    expect(loadSource).toHaveBeenCalledTimes(1)
    expect(loadSource).toHaveBeenCalledWith('new')
    expect(container.textContent).toContain('line 1')
  })

  it('keeps a 50k-line omitted source as lightweight ranges until a fold opens', () => {
    const lines = Array.from({ length: 50_000 }, (_value, index) => `line ${index + 1}`)
    const changed = [...lines]
    changed[24_999] = 'line 25000 changed'
    const oldSource = `${lines.join('\n')}\n`
    const newSource = `${changed.join('\n')}\n`
    const { container } = render(<DiffBlock
      diffs={[{
        path: 'huge.ts', oldStart: 24_998, newStart: 24_998,
        oldText: lines.slice(24_997, 25_002).join('\n'),
        newText: changed.slice(24_997, 25_002).join('\n'),
        oldSource, newSource,
      }]}
      variant="review"
      showPath={false}
      showFooter={false}
    />)

    expect(screen.getByRole('button', { name: '展开 24997 行' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开 24998 行' })).toBeTruthy()
    expect(bodyRows(container).length).toBeLessThan(10)
    expect(container.textContent).not.toContain('line 10000')
  })
})

describe('DiffBlock copy', () => {
  it('copies the prefixed diff text and flips the label on success', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const diffs: DiffHunk[] = [
      { path: 'a.ts', oldText: 'old', newText: 'new' },
      { path: 'a.ts', oldText: 'p', newText: 'q' },
    ]
    render(<DiffBlock diffs={diffs} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    // One file identity precedes all of its composed hunks.
    expect(writeText).toHaveBeenCalledWith('a.ts\n- old\n+ new\n- p\n+ q')
    expect(screen.getByRole('button', { name: '复制成功' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('keeps the label on a refused clipboard write', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
  })

  it('ignores a second click while the copied label is showing', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<DiffBlock diffs={[{ path: 'a.ts', oldText: null, newText: 'x' }]} />)
    const copy = screen.getByRole('button', { name: '复制' })
    await act(async () => { fireEvent.click(copy) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '复制成功' })) })
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
