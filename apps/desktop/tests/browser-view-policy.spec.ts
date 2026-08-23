import { describe, expect, it } from 'vitest'
import { allowedBrowserPanelUrl, browserPanelFitZoom, normalizeBrowserViewBounds } from '../src/browser-view-policy.ts'

describe('Browser Panel URL policy', () => {
  it('allows only HTTP(S)', () => {
    expect(allowedBrowserPanelUrl('https://example.com/a')?.href).toBe('https://example.com/a')
    expect(allowedBrowserPanelUrl('http://127.0.0.1:3000')?.port).toBe('3000')
    expect(allowedBrowserPanelUrl('file:///etc/passwd')).toBeUndefined()
    expect(allowedBrowserPanelUrl('javascript:alert(1)')).toBeUndefined()
    expect(allowedBrowserPanelUrl('not a url')).toBeUndefined()
  })
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
