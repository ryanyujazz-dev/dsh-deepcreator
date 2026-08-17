/** Browser-panel navigation is deliberately narrower than the main renderer. */
export function allowedBrowserPanelUrl(raw: string): URL | undefined {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch { return undefined }
}

export interface BrowserViewBounds { x: number; y: number; width: number; height: number }

export function normalizeBrowserViewBounds(value: BrowserViewBounds): BrowserViewBounds {
  const finite = (input: number): number => Number.isFinite(input) ? Math.round(input) : 0
  return {
    x: Math.max(0, finite(value.x)), y: Math.max(0, finite(value.y)),
    width: Math.max(0, finite(value.width)), height: Math.max(0, finite(value.height)),
  }
}
