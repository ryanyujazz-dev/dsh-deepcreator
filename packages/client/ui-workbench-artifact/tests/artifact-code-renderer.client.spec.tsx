// @vitest-environment jsdom
// ArtifactCodeRenderer: every text artifact renders through the line-numbered
// CodeSurface. Known languages add syntax tokens; unknown extensions keep the
// same Review-like row geometry with plain text content.

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ArtifactCodeRenderer } from '../src/client/ArtifactCodeRenderer.tsx'

afterEach(cleanup)

describe('ArtifactCodeRenderer', () => {
  it('renders markdown through the code surface with numbered rows', () => {
    const { container } = render(
      <ArtifactCodeRenderer artifactId="docs/report.md" content={'# 标题\n正文'} />,
    )
    const surface = container.querySelector('[data-code-surface]')
    expect(surface).not.toBeNull()
    expect(surface?.getAttribute('data-code-surface-variant')).toBe('document')
    const gutters = [...container.querySelectorAll('[class*="_gutter_"]')]
    expect(gutters.map(cell => cell.textContent)).toEqual(['1', '2'])
  })

  it('keeps non-markdown code paths on the default panel surface', () => {
    const { container } = render(
      <ArtifactCodeRenderer artifactId="src/index.ts" content={'const ok = true'} />,
    )
    expect(container.querySelector('[data-code-surface]')?.getAttribute('data-code-surface-variant')).toBe('panel')
  })

  it('keeps Review-like numbered rows for unknown extensions without syntax tokens', () => {
    const { container } = render(
      <ArtifactCodeRenderer artifactId="build/logo.svg.txt" content={'raw\nbytes'} />,
    )
    const surface = container.querySelector('[data-code-surface]')
    expect(surface?.getAttribute('data-code-surface-variant')).toBe('panel')
    expect(container.querySelector('pre')).toBeNull()
    expect(container.querySelector('[data-code-token]')).toBeNull()
    const gutters = [...container.querySelectorAll('[class*="_gutter_"]')]
    expect(gutters.map(cell => cell.textContent)).toEqual(['1', '2'])
  })
})
