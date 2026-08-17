/** Appearance row store: snapshot-mirror action and the revision guard. */
import { describe, expect, it } from 'vitest'
import { createAppearanceRowStore } from '../src/client/settings-store.ts'

describe('createAppearanceRowStore', () => {
  it('init shape: system preference with revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({
      preference: 'system', transcriptTextSize: 'standard',
      lightCodeTheme: 'deepcreator-light', darkCodeTheme: 'deepcreator-dark', codeFont: 'system', revision: -1,
    })
  })

  it('sync mirrors both preferences and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'large', 'github-light', 'one-dark', 'fira-code', 0)
    expect(store.getSnapshot()).toEqual({
      preference: 'dark', transcriptTextSize: 'large',
      lightCodeTheme: 'github-light', darkCodeTheme: 'one-dark', codeFont: 'fira-code', revision: 0,
    })
    store.actions.sync('light', 'small', 'one-light', 'github-dark', 'source-code-pro', 2)
    expect(store.getSnapshot().preference).toBe('light')
    expect(store.getSnapshot().transcriptTextSize).toBe('small')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync('dark', 'large', 'github-light', 'github-dark', 'system', 3)
    store.actions.sync('system', 'small', 'one-light', 'one-dark', 'fira-code', 2)
    store.actions.sync('system', 'small', 'one-light', 'one-dark', 'fira-code', 3)
    expect(store.getSnapshot().preference).toBe('dark')
    expect(store.getSnapshot().transcriptTextSize).toBe('large')
    expect(store.getSnapshot().revision).toBe(3)
  })
})
