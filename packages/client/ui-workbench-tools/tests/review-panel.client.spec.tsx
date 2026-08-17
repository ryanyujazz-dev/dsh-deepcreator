// @vitest-environment jsdom
import type { ComponentProps } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewPanel } from '../src/client/Panels.tsx'

afterEach(cleanup)

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

function props(): ComponentProps<typeof ReviewPanel> {
  const remote = {
    review: {
      status: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: true,
          repositoryRoot: '/workspace',
          branch: 'main',
          files: [
            { path: 'src/a.ts', index: ' ', workingTree: 'M' },
            { path: 'src/b.ts', index: ' ', workingTree: 'M' },
          ],
        },
      }),
      checks: vi.fn().mockResolvedValue({
        ok: true,
        value: { ok: true, repositoryRoot: '/workspace', clean: true, output: '' },
      }),
      diff: vi.fn(async (_sessionId: string, path: string) => ({
        ok: true,
        value: {
          ok: true,
          repositoryRoot: '/workspace',
          path,
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
  return {
    remote,
    useSessions: selector => selector({ currentAddress: undefined } as never),
    sessionId: 'session-1',
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
  } as ComponentProps<typeof ReviewPanel>
}

describe('Review Panel file stream', () => {
  it('renders one expandable file list and loads file diffs inline on demand', async () => {
    const input = props()
    const view = render(<ReviewPanel {...input} />)

    const first = await view.findByRole('button', { name: /src\/a\.ts/ })
    const second = await view.findByRole('button', { name: /src\/b\.ts/ })
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(view.getByText('review.layer.working')).toBeTruthy() })

    expect(view.queryByRole('navigation')).toBeNull()
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(second.getAttribute('aria-expanded')).toBe('false')
    expect(view.container.textContent).toContain('const value = 2')
    expect(view.container.textContent).not.toContain('export const ready = true')

    fireEvent.click(second)
    await waitFor(() => { expect(input.remote.review.diff).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(second.closest('article')?.textContent).toContain('export const ready = true') })
    expect(second.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(first)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(first.closest('article')?.textContent).not.toContain('const value = 2')
    expect(second.closest('article')?.textContent).toContain('export const ready = true')
  })

  it('keeps file headers sticky inside the single scrolling viewport', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-workbench-tools/src/client/Panels.module.css'), 'utf8')

    expect(stylesheet).toMatch(/\.reviewBody\s*\{[^}]*overflow:\s*visible;/)
    expect(stylesheet).toMatch(/\.reviewFileHeader\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/)
    expect(stylesheet).not.toMatch(/\.reviewBody\s*\{[^}]*grid-template-columns:/)
  })
})
