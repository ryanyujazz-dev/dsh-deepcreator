import { describe, expect, it } from 'vitest'
import { browserPanelFitZoom, normalizeBrowserViewBounds } from '../src/browser-view-policy.ts'

describe('Browser Panel URL policy', () => {
  it('normalizes renderer bounds before attaching a WebContentsView', () => {
    expect(normalizeBrowserViewBounds({ x: -2, y: 1.4, width: 200.6, height: Number.NaN }))
      .toEqual({ x: 0, y: 1, width: 201, height: 0 })
  })
  it('keeps responsive pages at 100% and fits fixed desktop widths into the panel', () => {
    expect(browserPanelFitZoom(660, 660)).toBe(1)
    expect(browserPanelFitZoom(660, 1_000)).toBe(0.66)
    expect(browserPanelFitZoom(150, 2_000)).toBe(0.25)
    expect(browserPanelFitZoom(Number.NaN, 1_000)).toBe(1)
  })
})
