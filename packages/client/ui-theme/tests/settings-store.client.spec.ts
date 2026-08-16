/** Appearance row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ preference: 'system', transcriptTextSize: 'standard', revision: -1 })
  })

  it('sync mirrors both preferences and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'large', 0)
    expect(store.getSnapshot()).toEqual({ preference: 'dark', transcriptTextSize: 'large', revision: 0 })
    store.actions.sync('light', 'small', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().transcriptTextSize).toBe('small')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'large', 3)
    store.actions.sync('system', 'small', 2)
    store.actions.sync('system', 'small', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().transcriptTextSize).toBe('large')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
