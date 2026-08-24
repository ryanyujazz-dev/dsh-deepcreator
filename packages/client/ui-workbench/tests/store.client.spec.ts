// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createWorkbenchStore, prepareWorkbenchPersistence, WORKBENCH_PERSIST_KEY,
} from '../src/client/store.ts'

const placement = (stageWidth = 1200, visibleTypeIds: readonly string[] = []) => ({ stageWidth, visibleTypeIds })

beforeEach(() => { localStorage.clear() })

describe('Workbench store topology', () => {
  it('keeps one Group per type and routes same-type instances into tabs', () => {
    const store = createWorkbenchStore().create('s1')
    store.actions.present('artifact', 'plan-1', 'instance', placement())
    store.actions.present('artifact', 'report-2', 'instance', placement(1200, ['artifact']))
    const state = store.store.getSnapshot()
    expect(state.groups).toHaveLength(1)
    expect(state.groups[0]).toMatchObject({ typeId: 'artifact', tabs: ['plan-1', 'report-2'], activeInstanceId: 'report-2' })
    expect(state.tracks.map(track => track.typeIds)).toEqual([['artifact']])
  })

  it('merges equivalent instance ids without treating normalization as a close', () => {
    const store = createWorkbenchStore().create('s1')
    store.actions.present('artifact', 'image.png', 'instance', placement())
    store.actions.present('artifact', '/workspace/image.png', 'instance', placement(1200, ['artifact']))
    store.actions.present('artifact', 'image.png', 'instance', placement(1200, ['artifact']))
    store.actions.replaceTab('artifact', 'image.png', '/workspace/image.png')
    expect(store.store.getSnapshot().groups[0]).toMatchObject({
      tabs: ['/workspace/image.png'], activeInstanceId: '/workspace/image.png', activeRoute: 'instance',
    })
  })

  it('opens every first panel at half the Conversation width and preserves a user-adjusted width', () => {
    for (const type of ['activity', 'terminal', 'artifact', 'review', 'browser']) {
      const first = createWorkbenchStore().create(`first-${type}`)
      first.actions.present(type, undefined, 'home', placement(1200))
      expect(first.store.getSnapshot().outerWidth).toBe(600)
    }

    const store = createWorkbenchStore().create('s1')
    store.actions.present('activity', undefined, 'home', placement(1200))
    store.actions.setOuterWidth(450)
    store.actions.present('terminal', undefined, 'home', placement(1200, ['activity']))
    expect(store.store.getSnapshot()).toMatchObject({ outerWidth: 450 })
    expect(store.store.getSnapshot().tracks.map(track => track.typeIds)).toEqual([['activity', 'terminal']])

    store.actions.hide('activity')
    store.actions.hide('terminal')
    expect(store.store.getSnapshot().tracks).toEqual([])
    store.actions.present('activity', undefined, 'home', placement(1200))
    expect(store.store.getSnapshot().outerWidth).toBe(450)
  })

  it('forms two equal columns for three/four types and three equal columns for five', () => {
    const store = createWorkbenchStore().create('s1')
    for (const [index, type] of ['activity', 'terminal', 'artifact', 'review', 'browser'].entries()) {
      const visible = store.store.getSnapshot().tracks.flatMap(track => track.typeIds)
      store.actions.present(type, undefined, 'home', placement(1200, visible))
      if (index === 2) {
        const state = store.store.getSnapshot()
        expect(state.outerWidth).toBe(600)
        expect(state.tracks.map(track => track.width)).toEqual([300, 300])
      }
      if (index === 3) expect(store.store.getSnapshot().outerWidth).toBe(600)
    }
    const state = store.store.getSnapshot()
    expect(state.outerWidth).toBe(800)
    expect(state.tracks.map(track => track.typeIds)).toEqual([
      ['activity', 'terminal'], ['artifact', 'review'], ['browser'],
    ])
    expect(new Set(state.tracks.map(track => track.width))).toHaveLength(1)
  })

  it('lets a sibling fill its column and removes an empty column without stretching survivors', () => {
    const store = createWorkbenchStore().create('s1')
    for (const type of ['activity', 'terminal', 'artifact', 'review', 'browser']) {
      store.actions.present(type, undefined, 'home', placement(1200, store.store.getSnapshot().tracks.flatMap(track => track.typeIds)))
    }
    const before = store.store.getSnapshot().tracks.map(track => track.width)
    store.actions.hide('activity')
    expect(store.store.getSnapshot().tracks[0]?.typeIds).toEqual(['terminal'])
    expect(store.store.getSnapshot().tracks[0]?.width).toBe(before[0])

    store.actions.hide('browser')
    const after = store.store.getSnapshot()
    expect(after.tracks.map(track => track.typeIds)).toEqual([['terminal'], ['artifact', 'review']])
    expect(after.tracks.map(track => track.width)).toEqual(before.slice(0, 2))
    expect(after.outerWidth).toBe(Math.round(before[0]! + before[1]!))
  })

  it('swaps a responsive-hidden type with the real top-left cell', () => {
    const store = createWorkbenchStore().create('s1')
    for (const type of ['activity', 'terminal', 'artifact', 'review', 'browser']) {
      store.actions.present(type, undefined, 'home', placement(1200, store.store.getSnapshot().tracks.flatMap(track => track.typeIds)))
    }
    store.actions.present('browser', undefined, 'home', placement(1200, ['activity', 'terminal']))
    expect(store.store.getSnapshot().tracks.map(track => track.typeIds)).toEqual([
      ['browser', 'terminal'], ['artifact', 'review'], ['activity'],
    ])
  })

  it('replaces the top-left type atomically when a new odd column cannot fit', () => {
    const store = createWorkbenchStore().create('s1')
    store.actions.present('activity', undefined, 'home', placement(600))
    store.actions.present('terminal', undefined, 'home', placement(600, ['activity']))
    store.actions.present('artifact', undefined, 'home', placement(600, ['activity', 'terminal']))
    const state = store.store.getSnapshot()
    expect(state.tracks.map(track => track.typeIds)).toEqual([['artifact', 'terminal']])
    expect(state.hiddenTypeIds).toContain('activity')
  })

  it('hides/restores a Group without losing tabs and reuses a half-empty column', () => {
    const store = createWorkbenchStore().create('s1')
    store.actions.present('artifact', 'plan-1', 'instance', placement())
    store.actions.present('review', undefined, 'home', placement(1200, ['artifact']))
    store.actions.hide('artifact')
    expect(store.store.getSnapshot().tracks.map(track => track.typeIds)).toEqual([['review']])
    store.actions.present('artifact', undefined, 'home', placement(1200, ['review']))
    expect(store.store.getSnapshot().tracks.map(track => track.typeIds)).toEqual([['review', 'artifact']])
    expect(store.store.getSnapshot().groups.find(group => group.typeId === 'artifact')?.tabs).toEqual(['plan-1'])
  })

  it('persists topology per Session and clears with the runtime scope hook', () => {
    const store = createWorkbenchStore().create('s1')
    store.actions.present('activity', undefined, 'home', placement())
    expect(localStorage.getItem(`${WORKBENCH_PERSIST_KEY}.s1`)).not.toBeNull()
    expect(createWorkbenchStore().create('s1').store.getSnapshot().tracks[0]?.typeIds).toEqual(['activity'])
    store.clearPersisted()
    expect(localStorage.getItem(`${WORKBENCH_PERSIST_KEY}.s1`)).toBeNull()
  })
})

describe('prepareWorkbenchPersistence', () => {
  it('removes v1, corrupt and unknown snapshots while retaining valid v2', () => {
    localStorage.setItem('dsh.deepcreator.workbench.session.v1.old', JSON.stringify({ schemaVersion: 1 }))
    localStorage.setItem(`${WORKBENCH_PERSIST_KEY}.broken`, '{')
    localStorage.setItem(`${WORKBENCH_PERSIST_KEY}.future`, JSON.stringify({ schemaVersion: 9 }))
    const valid = {
      schemaVersion: 2, outerWidth: 400, groups: [], tracks: [], hiddenTypeIds: [], focusedTypeId: null,
    }
    localStorage.setItem(`${WORKBENCH_PERSIST_KEY}.valid`, JSON.stringify(valid))
    prepareWorkbenchPersistence()
    expect(localStorage.getItem('dsh.deepcreator.workbench.session.v1.old')).toBeNull()
    expect(localStorage.getItem(`${WORKBENCH_PERSIST_KEY}.broken`)).toBeNull()
    expect(localStorage.getItem(`${WORKBENCH_PERSIST_KEY}.future`)).toBeNull()
    expect(localStorage.getItem(`${WORKBENCH_PERSIST_KEY}.valid`)).not.toBeNull()
  })
})
