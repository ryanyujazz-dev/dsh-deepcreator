import { describe, expect, it } from 'vitest'
import { shouldCloseAfterFailedPresentation } from '../src/index.ts'
import type { BrowserTabState } from '../src/types.ts'

const tab = (overrides: Partial<BrowserTabState> = {}): BrowserTabState => ({
  tabId: 'tab-1', browserId: 'iab', url: 'https://example.test/', title: 'Example', loading: false,
  canGoBack: false, canGoForward: false, lifecycle: 'temporary', presentation: 'live',
  presentationBinding: { owner: 'deepcreator', mode: 'live', requiredBeforeControl: true },
  controlState: 'presentation-required', presentationState: 'pending', surfaceId: 'surface-1', ...overrides,
})

describe('Browser presentation rollback policy', () => {
  it('closes resolver-created tabs and fresh temporary IAB tabs after presentation failure', () => {
    expect(shouldCloseAfterFailedPresentation(tab({ presentation: 'snapshot', controlState: 'ready' }), true)).toBe(true)
    expect(shouldCloseAfterFailedPresentation(tab(), false)).toBe(true)
  })

  it('preserves tabs already presented to the user and explicitly retained tabs', () => {
    expect(shouldCloseAfterFailedPresentation(tab({ controlState: 'ready', presentationState: 'presented' }), false)).toBe(false)
    expect(shouldCloseAfterFailedPresentation(tab({ lifecycle: 'deliverable' }), false)).toBe(false)
  })
})
