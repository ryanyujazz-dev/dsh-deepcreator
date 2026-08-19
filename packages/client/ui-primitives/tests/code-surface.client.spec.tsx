// @vitest-environment jsdom
// CodeSurface: one numbered row per source line (a trailing newline adds no
// phantom row), per-line shiki runs for a registered grammar with a plain
// fallback for unknown languages, and the wrap-mode row geometry (gutter +
// content grid, soft-wrap content cell).

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { CodeSurface } from '../src/index.ts'

afterEach(cleanup)

function rows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll('[class*="_line_"]')] as HTMLElement[]
}

function gutters(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[class*="_gutter_"]')].map(cell => cell.textContent ?? '')
}

describe('CodeSurface', () => {
  it('numbers every source line and drops a trailing newline phantom row', () => {
    const { container } = render(<CodeSurface content={'# title\n\nbody\n'} lang="markdown" />)
    expect(rows(container)).toHaveLength(3)
    expect(gutters(container)).toEqual(['1', '2', '3'])
  })

  it('renders zero rows for an empty file', () => {
    const { container } = render(<CodeSurface content="" lang="markdown" />)
    expect(rows(container)).toHaveLength(0)
  })

  it('highlights a registered grammar through the shared token chain', async () => {
    const { container } = render(<CodeSurface content={'# heading\n'} lang="md" />)
    // The markdown grammar is lazy: the surface starts plain and picks up the
    // tokens once the grammar import lands (the subscribeGrammarLoaded bump).
    await waitFor(() => { expect(container.querySelector('[data-code-token]')).not.toBeNull() })
    const token = container.querySelector('[data-code-token]') as HTMLElement
    expect(token.style.getPropertyValue('--shiki-deepcreator-light')).not.toBe('')
  })

  it('falls back to plain text for an unknown language', () => {
    const { container } = render(<CodeSurface content={'hello\nworld'} lang="no-such-lang" />)
    expect(container.querySelector('[data-code-token]')).toBeNull()
    expect(rows(container).map(row => row.textContent)).toEqual(['1hello', '2world'])
  })

  it('marks the document variant for editor-style markdown artifact layout', () => {
    const { container } = render(<CodeSurface content={'# title'} lang="markdown" variant="document" />)
    expect(container.querySelector('[data-code-surface]')?.getAttribute('data-code-surface-variant')).toBe('document')
  })
})
