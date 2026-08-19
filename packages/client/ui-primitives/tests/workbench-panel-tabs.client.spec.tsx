// @vitest-environment jsdom
// WorkbenchPanelTabs: pills size to their label and only fade when the label
// actually clips (scrollWidth over clientWidth, re-measured on resize), and
// every label exposes its full text as a hover tooltip.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WorkbenchPanelTabs } from '../src/index.ts'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Force every span to report clipping ink (or not) for one test body. */
function withSpanMetrics(scrollWidth: number, clientWidth: number, body: () => void): void {
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
  vi.useRealTimers()
})

function mount(label: string) {
  return render(
    <WorkbenchPanelTabs
      tabs={['tab-1']}
      labels={{ 'tab-1': label }}
      closeTabLabel={() => 'close'}
      onActivateTab={() => {}}
      onCloseTab={() => {}}
    />,
  )
}

describe('WorkbenchPanelTabs truncation fade', () => {
  it('marks a clipped label with data-truncated for the fade mask', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    withSpanMetrics(200, 120, () => {
      const { container } = mount('A very long subagent label')
      const pill = container.querySelector('[data-truncated]')
      expect(pill).not.toBeNull()
      expect(screen.getByRole('tab').textContent).toBe('A very long subagent label')
    })
  })

  it('leaves fitting labels unmarked so short pills never fade', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    withSpanMetrics(80, 120, () => {
      const { container } = mount('writer')
      expect(container.querySelector('[data-truncated]')).toBeNull()
    })
  })
})

describe('WorkbenchPanelTabs hover hint', () => {
  it('shows the full label in a tooltip after the hover delay', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    vi.useFakeTimers()
    withSpanMetrics(80, 120, () => {
      mount('# heading body')
      fireEvent.mouseEnter(screen.getByRole('tab'))
      act(() => { vi.advanceTimersByTime(500) })
      expect(screen.getByRole('tooltip').textContent).toBe('# heading body')
      fireEvent.mouseLeave(screen.getByRole('tab'))
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })
})
