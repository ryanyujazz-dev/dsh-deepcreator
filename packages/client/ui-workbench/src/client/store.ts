import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { PanelRoute } from './contract.ts'
import {
  MIN_PANEL_COLUMN_WIDTH, initialWorkbenchWidth, oddTrackWorkbenchWidth,
} from './layout.ts'

export const WORKBENCH_PERSIST_KEY = 'dsh.deepcreator.workbench.session.v2'
export const WORKBENCH_SCHEMA_VERSION = 2
export const WORKBENCH_DEFAULT_WIDTH = 520
const LEGACY_PERSIST_KEY = 'dsh.deepcreator.workbench.session.v1'
const MAX_TRACKS = 3

export interface WorkbenchGroupState {
  typeId: string
  tabs: string[]
  activeInstanceId?: string
  activeRoute: PanelRoute
}

/** One stable left-to-right Workbench column; one type fills it, two split it vertically. */
export interface WorkbenchTrackState {
  typeIds: string[]
  /** Preferred pixel width when the full topology fits. */
  width: number
  /** Vertical ratios for the one or two cells in this column. */
  cellRatios: number[]
}

export interface WorkbenchPlacement {
  /** Stage means Conversation + Workbench, excluding Sidebar. */
  stageWidth: number
  /** Types actually rendered after responsive right-to-left column removal. */
  visibleTypeIds: readonly string[]
  /** Provider-owned first-open ratio: one third or one half. */
  initialWidthRatio: number
}

export interface WorkbenchState {
  schemaVersion: 2
  outerWidth: number
  groups: WorkbenchGroupState[]
  /** Explicit topology. Hidden Groups remain in `groups` but have no Track cell. */
  tracks: WorkbenchTrackState[]
  hiddenTypeIds: string[]
  focusedTypeId: string | null
}

type WorkbenchActions = {
  present: (
    draft: WorkbenchState,
    typeId: string,
    instanceId: string | undefined,
    route: PanelRoute,
    placement?: WorkbenchPlacement,
  ) => void
  hide: (draft: WorkbenchState, typeId: string) => void
  closeTab: (draft: WorkbenchState, typeId: string, instanceId: string) => void
  showHome: (draft: WorkbenchState, typeId: string) => void
  setOuterWidth: (draft: WorkbenchState, width: number) => void
  completeOuterResize: (draft: WorkbenchState, startWidth: number, endWidth: number) => void
  focus: (draft: WorkbenchState, typeId: string) => void
  restoreFocus: (draft: WorkbenchState) => void
  resizeTracks: (draft: WorkbenchState, index: number, deltaPx: number) => void
  resizeCells: (draft: WorkbenchState, trackIndex: number, index: number, delta: number) => void
}

const initialState = (): WorkbenchState => ({
  schemaVersion: WORKBENCH_SCHEMA_VERSION,
  outerWidth: WORKBENCH_DEFAULT_WIDTH,
  groups: [],
  tracks: [],
  hiddenTypeIds: [],
  focusedTypeId: null,
})

function groupOf(state: WorkbenchState, typeId: string): WorkbenchGroupState | undefined {
  return state.groups.find(group => group.typeId === typeId)
}

function locationOf(state: WorkbenchState, typeId: string): { track: number; cell: number } | undefined {
  for (let track = 0; track < state.tracks.length; track += 1) {
    const cell = state.tracks[track]!.typeIds.indexOf(typeId)
    if (cell >= 0) return { track, cell }
  }
  return undefined
}

function topologyWidth(tracks: readonly WorkbenchTrackState[]): number {
  if (tracks.length === 0) return 0
  return Math.round(tracks.reduce((sum, track) => sum + track.width, 0))
}

function equalizeTracks(state: WorkbenchState, outerWidth: number): void {
  const width = Math.max(MIN_PANEL_COLUMN_WIDTH, outerWidth / Math.max(1, state.tracks.length))
  for (const track of state.tracks) track.width = width
  state.outerWidth = topologyWidth(state.tracks)
}

function replaceTopLeft(state: WorkbenchState, typeId: string): void {
  const first = state.tracks[0]?.typeIds[0]
  if (first === undefined || first === typeId) return
  state.tracks[0]!.typeIds[0] = typeId
  if (!state.hiddenTypeIds.includes(first)) state.hiddenTypeIds.push(first)
  state.hiddenTypeIds = state.hiddenTypeIds.filter(id => id !== typeId)
  if (state.focusedTypeId === first) state.focusedTypeId = null
}

function swapWithTopLeft(state: WorkbenchState, typeId: string): void {
  const target = locationOf(state, typeId)
  const first = state.tracks[0]?.typeIds[0]
  if (target === undefined || first === undefined || first === typeId) return
  state.tracks[0]!.typeIds[0] = typeId
  state.tracks[target.track]!.typeIds[target.cell] = first
}

function placeNewType(state: WorkbenchState, typeId: string, placement?: WorkbenchPlacement): void {
  state.hiddenTypeIds = state.hiddenTypeIds.filter(id => id !== typeId)
  if (state.tracks.length === 0) {
    const width = initialWorkbenchWidth(
      placement?.stageWidth ?? WORKBENCH_DEFAULT_WIDTH * 3,
      placement?.initialWidthRatio ?? 1 / 3,
    )
    state.tracks.push({ typeIds: [typeId], width, cellRatios: [1] })
    state.outerWidth = width
    return
  }

  // A deletion leaves its sibling full-height. The next type reuses the
  // first half-empty column before a new column is considered.
  const vacancy = state.tracks.find(track => track.typeIds.length === 1)
  if (vacancy !== undefined) {
    vacancy.typeIds.push(typeId)
    vacancy.cellRatios = [1, 1]
    return
  }

  if (state.tracks.length >= MAX_TRACKS) {
    replaceTopLeft(state, typeId)
    return
  }

  const nextTrackCount = state.tracks.length + 1
  const targetOuterWidth = oddTrackWorkbenchWidth(
    placement?.stageWidth ?? Math.max(900, state.outerWidth * nextTrackCount / state.tracks.length),
    nextTrackCount,
  )
  const required = nextTrackCount * MIN_PANEL_COLUMN_WIDTH
  if (targetOuterWidth < required) {
    replaceTopLeft(state, typeId)
    return
  }

  state.tracks.push({ typeIds: [typeId], width: MIN_PANEL_COLUMN_WIDTH, cellRatios: [1] })
  equalizeTracks(state, targetOuterWidth)
}

function removeFromTopology(state: WorkbenchState, typeId: string): void {
  const location = locationOf(state, typeId)
  if (location === undefined) return
  const track = state.tracks[location.track]!
  track.typeIds.splice(location.cell, 1)
  if (track.typeIds.length === 0) {
    state.tracks.splice(location.track, 1)
  } else {
    track.cellRatios = [1]
  }
  if (state.tracks.length > 0) state.outerWidth = topologyWidth(state.tracks)
}

export function createWorkbenchStore(): EngineStoreHandle<WorkbenchState, WorkbenchActions> {
  return defineStore({
    init: initialState,
    persist: WORKBENCH_PERSIST_KEY,
    actions: {
      present: (d, typeId, instanceId, route, placement) => {
        let group = groupOf(d, typeId)
        if (group === undefined) {
          group = { typeId, tabs: [], activeRoute: route }
          d.groups.push(group)
        }

        const location = locationOf(d, typeId)
        if (location === undefined) {
          placeNewType(d, typeId, placement)
        } else if (placement !== undefined && !placement.visibleTypeIds.includes(typeId)) {
          // Responsive-hidden types become visible by exchanging their real
          // topology cell with the real top-left cell. Widening therefore
          // reveals the updated topology, never an historical projection.
          swapWithTopLeft(d, typeId)
        }

        group.activeRoute = route
        if (instanceId !== undefined) {
          if (!group.tabs.includes(instanceId)) group.tabs.push(instanceId)
          group.activeInstanceId = instanceId
          group.activeRoute = 'instance'
        }
      },
      hide: (d, typeId) => {
        if (groupOf(d, typeId) === undefined || d.hiddenTypeIds.includes(typeId)) return
        removeFromTopology(d, typeId)
        d.hiddenTypeIds.push(typeId)
        if (d.focusedTypeId === typeId) d.focusedTypeId = null
      },
      closeTab: (d, typeId, instanceId) => {
        const group = groupOf(d, typeId)
        if (group === undefined) return
        group.tabs = group.tabs.filter(id => id !== instanceId)
        if (group.activeInstanceId !== instanceId) return
        const replacement = group.tabs.at(-1)
        if (replacement === undefined) delete group.activeInstanceId
        else group.activeInstanceId = replacement
        group.activeRoute = replacement === undefined ? 'home' : 'instance'
      },
      showHome: (d, typeId) => {
        const group = groupOf(d, typeId)
        if (group !== undefined) group.activeRoute = 'home'
      },
      setOuterWidth: (d, width) => {
        const next = Math.max(MIN_PANEL_COLUMN_WIDTH, Math.round(width))
        const required = d.tracks.length * MIN_PANEL_COLUMN_WIDTH
        if (d.tracks.length > 0 && next >= required) equalizeTracks(d, next)
        else d.outerWidth = next
      },
      completeOuterResize: (d, _startWidth, endWidth) => {
        const next = Math.max(MIN_PANEL_COLUMN_WIDTH, Math.round(endWidth))
        const required = d.tracks.length * MIN_PANEL_COLUMN_WIDTH
        if (d.tracks.length > 0 && next >= required) equalizeTracks(d, next)
        else d.outerWidth = next
      },
      focus: (d, typeId) => {
        if (locationOf(d, typeId) !== undefined) d.focusedTypeId = typeId
      },
      restoreFocus: (d) => { d.focusedTypeId = null },
      resizeTracks: (d, index, deltaPx) => {
        const left = d.tracks[index]
        const right = d.tracks[index + 1]
        if (left === undefined || right === undefined) return
        const amount = Math.max(MIN_PANEL_COLUMN_WIDTH - left.width, Math.min(right.width - MIN_PANEL_COLUMN_WIDTH, deltaPx))
        left.width += amount
        right.width -= amount
        d.outerWidth = topologyWidth(d.tracks)
      },
      resizeCells: (d, trackIndex, index, delta) => {
        const track = d.tracks[trackIndex]
        if (track === undefined) return
        const first = track.cellRatios[index] ?? 1
        const second = track.cellRatios[index + 1] ?? 1
        const amount = Math.max(-first + 0.2, Math.min(second - 0.2, delta))
        track.cellRatios[index] = first + amount
        track.cellRatios[index + 1] = second - amount
      },
    },
  })
}

function validStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function validTrack(value: unknown): value is WorkbenchTrackState {
  if (typeof value !== 'object' || value === null) return false
  const track = value as Record<string, unknown>
  return validStringArray(track.typeIds)
    && track.typeIds.length >= 1
    && track.typeIds.length <= 2
    && typeof track.width === 'number'
    && Array.isArray(track.cellRatios)
    && track.cellRatios.every(item => typeof item === 'number')
}

/** Remove corrupt/current-unknown snapshots and the intentionally retired v1 topology. */
export function prepareWorkbenchPersistence(storage: Storage = localStorage): void {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (key === null) continue
    if (key.startsWith(`${LEGACY_PERSIST_KEY}.`)) {
      storage.removeItem(key)
      continue
    }
    if (!key.startsWith(`${WORKBENCH_PERSIST_KEY}.`)) continue
    const raw = storage.getItem(key)
    let parsed: unknown
    try { parsed = raw === null ? null : JSON.parse(raw) } catch { storage.removeItem(key); continue }
    if (typeof parsed !== 'object' || parsed === null) { storage.removeItem(key); continue }
    const candidate = parsed as Record<string, unknown>
    if (
      candidate.schemaVersion !== WORKBENCH_SCHEMA_VERSION
      || typeof candidate.outerWidth !== 'number'
      || !Array.isArray(candidate.groups)
      || !Array.isArray(candidate.tracks)
      || !candidate.tracks.every(validTrack)
      || !validStringArray(candidate.hiddenTypeIds)
    ) storage.removeItem(key)
  }
}
