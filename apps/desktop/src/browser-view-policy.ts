export interface BrowserViewBounds { x: number; y: number; width: number; height: number }

export function normalizeBrowserViewBounds(value: BrowserViewBounds): BrowserViewBounds {
  const finite = (input: number): number => Number.isFinite(input) ? Math.round(input) : 0
  return {
    x: Math.max(0, finite(value.x)), y: Math.max(0, finite(value.y)),
    width: Math.max(0, finite(value.width)), height: Math.max(0, finite(value.height)),
  }
}

/**
 * Keep fixed-width desktop pages inside a narrow Browser Surface without
 * changing UA/profile identity. Responsive pages remain at 100% zoom.
 */
export function browserPanelFitZoom(viewportWidth: number, contentWidth: number): number {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(contentWidth) || viewportWidth <= 0 || contentWidth <= viewportWidth + 1) return 1
  return Math.max(0.25, Math.min(1, Math.round((viewportWidth / contentWidth) * 1_000) / 1_000))
}
