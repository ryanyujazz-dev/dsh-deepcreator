// @vitest-environment jsdom
// ArtifactCodeRenderer: code-known paths (markdown included) render through
// the line-numbered CodeSurface; unknown extensions keep the panel's plain
// <pre> fallback verbatim.

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

  it('keeps the plain pre fallback for unknown extensions', () => {
    const { container } = render(
      <ArtifactCodeRenderer artifactId="build/logo.svg.txt" content={'raw\nbytes'} />,
    )
    expect(container.querySelector('[data-code-surface]')).toBeNull()
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('raw\nbytes')
  })
})
