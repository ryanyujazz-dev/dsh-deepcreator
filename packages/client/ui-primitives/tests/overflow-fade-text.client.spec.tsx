// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { OverflowFadeText } from '../src/OverflowFadeText.tsx'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function withMetrics(scrollWidth: number, clientWidth: number, body: () => void): void {
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth })
  try {
    body()
  } finally {
    if (scroll !== undefined) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scroll)
    if (client !== undefined) Object.defineProperty(HTMLElement.prototype, 'clientWidth', client)
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OverflowFadeText', () => {
  it('marks a clipped file path for a left-edge fade that preserves its tail', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    withMetrics(240, 100, () => {
      const view = render(<OverflowFadeText text="packages/client/src/chat.tsx" fade="left" />)
      expect(view.container.querySelector('[data-overflow-fade="left"][data-truncated]')).not.toBeNull()
    })
  })

  it('marks a clipped prose title for a right-edge fade that preserves its start', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    withMetrics(240, 100, () => {
      const view = render(<OverflowFadeText text="Test context trimming logic" fade="right" />)
      expect(view.container.querySelector('[data-overflow-fade="right"][data-truncated]')).not.toBeNull()
    })
  })

  it('does not fade text that fits', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    withMetrics(80, 100, () => {
      const view = render(<OverflowFadeText text="chat.tsx" fade="left" />)
      expect(view.container.querySelector('[data-truncated]')).toBeNull()
    })
  })

  it('uses opposite masks and tail alignment for the two title kinds', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-primitives/src/OverflowFadeText.module.css'), 'utf8')
    expect(stylesheet).toMatch(/data-overflow-fade='left'[^}]*data-truncated[^}]*justify-content:\s*flex-end;/s)
    expect(stylesheet).toMatch(/data-overflow-fade='left'[^}]*mask-image:\s*linear-gradient\(to right, transparent 0, #000 16px, #000 100%\);/s)
    expect(stylesheet).toMatch(/data-overflow-fade='right'[^}]*mask-image:\s*linear-gradient\(to right, #000 0, #000 calc\(100% - 16px\), transparent 100%\);/s)
  })
})
