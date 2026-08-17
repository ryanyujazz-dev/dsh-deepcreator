import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { WorkbenchPanelShell } from '@ryanyujazz/dsh-client-ui-primitives'
import type {
  PanelTypeDefinition, WorkbenchPanelHeaderContribution, WorkbenchPanelOwnerProps, WorkbenchRootProps,
} from './contract.ts'
import type { WorkbenchGroupState } from './store.ts'
import type { WorkbenchCommand } from './service.ts'
import { SPLITTER_SIZE, visibleTrackCount } from './layout.ts'
import css from './WorkbenchRoot.module.css'

function Splitter({ orientation, className, style, onResize }: { orientation: 'horizontal' | 'vertical'; className: string | undefined; style?: CSSProperties; onResize(delta: number): void }) {
  const last = useRef<number | null>(null)
  return (
    <div
      className={className}
      style={style}
      role="separator"
      aria-orientation={orientation}
      tabIndex={0}
      onKeyDown={(event) => {
        const decrement = orientation === 'vertical' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
        const increment = orientation === 'vertical' ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
        if (!decrement && !increment) return
        event.preventDefault()
        onResize(increment ? (orientation === 'vertical' ? 16 : 0.1) : (orientation === 'vertical' ? -16 : -0.1))
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        last.current = orientation === 'vertical' ? event.clientX : event.clientY
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || last.current === null) return
        const current = orientation === 'vertical' ? event.clientX : event.clientY
        onResize(orientation === 'vertical' ? current - last.current : (current - last.current) / 200)
        last.current = current
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        last.current = null
      }}
    />
  )
}

function commandEffect(
  command: WorkbenchCommand,
  actions: WorkbenchRootProps['actions'],
  placement: { stageWidth: number; visibleTypeIds: readonly string[]; initialWidthRatio(typeId: string): number },
): void {
  switch (command.action.kind) {
    case 'present': {
      const { request } = command.action
      if (request.reason === 'agent' && request.reveal !== true) return
      actions.present(
        request.typeId,
        request.instanceId,
        request.route ?? (request.instanceId === undefined ? 'home' : 'instance'),
        {
          stageWidth: placement.stageWidth,
          visibleTypeIds: placement.visibleTypeIds,
          initialWidthRatio: placement.initialWidthRatio(request.typeId),
        },
      )
      return
    }
    case 'hide': actions.hide(command.action.typeId); return
    case 'close-tab': actions.closeTab(command.action.typeId, command.action.instanceId); return
    case 'focus': actions.focus(command.action.typeId); return
    case 'restore-focus': actions.restoreFocus(); return
  }
}

function Group({
  group, definition, focused, renderPanel, renderArtifact, onHide, onFocus, onRestore, actions, t,
}: {
  group: WorkbenchGroupState
  definition: PanelTypeDefinition | undefined
  focused: boolean
  renderPanel(owner: WorkbenchPanelOwnerProps): ReactNode
  renderArtifact: WorkbenchPanelOwnerProps['renderArtifact']
  onHide(): void
  onFocus(): void
  onRestore(): void
  actions: WorkbenchRootProps['actions']
  t: WorkbenchRootProps['t']
}) {
  const label = definition?.label() ?? group.typeId
  const [headerActions, setHeaderActions] = useState<WorkbenchPanelHeaderContribution>({})
  const headerContributionSequence = useRef(0)
  const contributeHeaderActions = useCallback((contribution: WorkbenchPanelHeaderContribution) => {
    const sequence = ++headerContributionSequence.current
    setHeaderActions(contribution)
    return () => {
      if (headerContributionSequence.current !== sequence) return
      setHeaderActions({})
    }
  }, [])
  const openInstance = useCallback((instanceId: string) => { actions.present(group.typeId, instanceId, 'instance') }, [actions, group.typeId])
  const closeInstance = useCallback((instanceId: string) => { actions.closeTab(group.typeId, instanceId) }, [actions, group.typeId])
  const showHome = useCallback(() => { actions.showHome(group.typeId) }, [actions, group.typeId])
  const owner = {
    typeId: group.typeId,
    route: group.activeRoute,
    tabs: group.tabs,
    ...(group.activeInstanceId === undefined ? {} : { activeInstanceId: group.activeInstanceId }),
    openInstance,
    activateInstance: openInstance,
    closeInstance,
    showHome,
    contributeHeaderActions,
    renderArtifact,
  }
  return (
    <WorkbenchPanelShell
      typeId={group.typeId}
      label={label}
      route={group.activeRoute}
      tabs={group.tabs}
      {...(group.activeInstanceId === undefined ? {} : { activeInstanceId: group.activeInstanceId })}
      supportsHome={definition?.supportsHome === true}
      focused={focused}
      backLabel={t('back', { type: label })}
      focusLabel={t('focus')}
      restoreLabel={t('restore')}
      closeGroupLabel={t('closeGroup', { type: label })}
      closeTabLabel={tab => t('closeTab', { tab })}
      onShowHome={() => { actions.showHome(group.typeId) }}
      onActivateTab={tab => { actions.present(group.typeId, tab, 'instance') }}
      onCloseTab={tab => { actions.closeTab(group.typeId, tab) }}
      onHide={onHide}
      onFocus={onFocus}
      onRestore={onRestore}
      leftActions={headerActions.left}
      rightActions={headerActions.right}
      disconnected={definition === undefined ? <div className={css.disconnected}>{t('disconnected')}</div> : undefined}
    >
      {renderPanel(owner)}
    </WorkbenchPanelShell>
  )
}

export function WorkbenchRoot({
  useStore, actions, renderSlot, controller, width, stageWidth, resizeGesture, t,
}: WorkbenchRootProps) {
  useSyncExternalStore(controller.types.subscribe, controller.types.version)
  const command = useSyncExternalStore(controller.commands.subscribe, controller.commands.getSnapshot)
  const groups = useStore(state => state.groups)
  const tracks = useStore(state => state.tracks)
  const storedWidth = useStore(state => state.outerWidth)
  const focusedTypeId = useStore(state => state.focusedTypeId)
  const definitions = controller.types.list()
  const definitionById = useMemo(() => new Map(definitions.map(def => [def.id, def])), [definitions])
  const processed = useRef(0)
  const dragStart = useRef<number | null>(null)
  const responsiveTrackCount = visibleTrackCount(tracks.length, width)
  const responsiveTracks = tracks.slice(0, responsiveTrackCount)
  const responsiveTypeIds = responsiveTracks.flatMap(track => track.typeIds)
  const topologyTypeIds = tracks.flatMap(track => track.typeIds)
  const shownTypeIds = focusedTypeId === null ? responsiveTypeIds : topologyTypeIds.includes(focusedTypeId) ? [focusedTypeId] : []
  const shownIds = new Set(shownTypeIds)
  const locationByType = useMemo(() => {
    const locations = new Map<string, { track: number; cell: number; span: boolean }>()
    tracks.forEach((track, trackIndex) => {
      track.typeIds.forEach((typeId, cell) => { locations.set(typeId, { track: trackIndex, cell, span: track.typeIds.length === 1 }) })
    })
    return locations
  }, [tracks])

  useEffect(() => {
    if (command === null || command.sequence <= processed.current) return
    processed.current = command.sequence
    if (
      command.action.kind === 'present'
      && (command.action.request.reason !== 'agent' || command.action.request.reveal === true)
      && focusedTypeId !== null
      && topologyTypeIds.includes(command.action.request.typeId)
    ) {
      actions.focus(command.action.request.typeId)
      actions.present(
        command.action.request.typeId,
        command.action.request.instanceId,
        command.action.request.route ?? (command.action.request.instanceId === undefined ? 'home' : 'instance'),
      )
      return
    }
    commandEffect(command, actions, {
      stageWidth,
      visibleTypeIds: shownTypeIds,
      initialWidthRatio: typeId => definitionById.get(typeId)?.initialWidthRatio ?? 1 / 3,
    })
  }, [actions, command, definitionById, focusedTypeId, shownTypeIds, stageWidth, topologyTypeIds])

  useEffect(() => {
    if (tracks.length === 0) controller.restoreFocus()
  }, [controller, tracks.length])

  useEffect(() => {
    if (tracks.length === 0) {
      controller.layout.close()
      return
    }
    controller.layout.open(storedWidth)
  }, [controller, storedWidth, tracks.length])

  useEffect(() => { controller.layout.focus(focusedTypeId !== null) }, [controller, focusedTypeId])

  useEffect(() => {
    if (resizeGesture !== null) {
      dragStart.current ??= resizeGesture.startWidth
      if (width > 0) actions.setOuterWidth(width)
      return
    }
    if (dragStart.current !== null) {
      actions.completeOuterResize(dragStart.current, width)
      dragStart.current = null
    }
  }, [actions, resizeGesture, width])

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && focusedTypeId !== null) actions.restoreFocus()
    }
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('keydown', escape) }
  }, [actions, focusedTypeId])

  useEffect(() => {
    controller.setVisibleTypes(shownTypeIds)
  }, [controller, shownTypeIds])

  const gridTemplateColumns = focusedTypeId === null
    ? responsiveTracks.flatMap((track, index) => index === responsiveTracks.length - 1
      ? [`minmax(0, ${track.width}fr)`]
      : [`minmax(0, ${track.width}fr)`, `${SPLITTER_SIZE}px`]).join(' ')
    : 'minmax(0, 1fr)'

  return (
    <div className={css.root} data-focused={focusedTypeId !== null || undefined} data-visible-tracks={responsiveTrackCount}>
      {shownTypeIds.length === 0 && <div className={css.empty}>{t('empty')}</div>}
      {groups.length > 0 && (
        <div className={css.tracks} aria-hidden={shownTypeIds.length === 0 || undefined} style={{ gridTemplateColumns }}>
          {groups.map((group) => {
            const location = locationByType.get(group.typeId)
            const visible = shownIds.has(group.typeId)
            const column = focusedTypeId !== null ? 1 : location === undefined ? 1 : location.track * 2 + 1
            const track = location === undefined ? undefined : tracks[location.track]
            const cellTotal = track?.cellRatios.reduce((sum, value) => sum + value, 0) ?? 1
            const firstFraction = (track?.cellRatios[0] ?? 1) / cellTotal
            const cellStyle: CSSProperties = focusedTypeId !== null || location?.span === true
              ? { gridColumn: column, gridRow: 1, alignSelf: 'stretch', height: '100%', display: visible ? undefined : 'none' }
              : location?.cell === 0
                ? { gridColumn: column, gridRow: 1, alignSelf: 'start', height: `calc(${firstFraction * 100}% - 2px)`, display: visible ? undefined : 'none' }
                : { gridColumn: column, gridRow: 1, alignSelf: 'end', height: `calc(${(1 - firstFraction) * 100}% - 2px)`, display: visible ? undefined : 'none' }
            return (
              <div className={css.cell} key={group.typeId} style={cellStyle}>
                  <Group
                    group={group}
                    definition={definitionById.get(group.typeId)}
                    focused={focusedTypeId === group.typeId}
                    actions={actions}
                    t={t}
                    onHide={() => { actions.hide(group.typeId) }}
                    onFocus={() => { actions.focus(group.typeId) }}
                    onRestore={() => { actions.restoreFocus() }}
                    renderPanel={(owner) => renderSlot('deepcreator.workbench.panel', owner, { only: group.typeId })}
                    renderArtifact={(artifact) => renderSlot('deepcreator.workbench.artifact.renderer', artifact, {
                      only: artifact.kind,
                      fallback: <pre>{artifact.content}</pre>,
                    })}
                  />
              </div>
            )
          })}
          {focusedTypeId === null && responsiveTracks.map((track, trackIndex) => {
            if (track.typeIds.length !== 2) return null
            const total = track.cellRatios.reduce((sum, value) => sum + value, 0)
            const fraction = (track.cellRatios[0] ?? 1) / total
            return <Splitter key={`cell:${trackIndex}`} className={css.cellSplitter} orientation="horizontal" style={{ gridColumn: trackIndex * 2 + 1, gridRow: 1, alignSelf: 'start', position: 'relative', top: `calc(${fraction * 100}% - 2px)` }} onResize={delta => { actions.resizeCells(trackIndex, 0, delta) }} />
          })}
          {focusedTypeId === null && responsiveTracks.slice(0, -1).map((_track, trackIndex) => (
            <Splitter key={`track:${trackIndex}`} className={css.trackSplitter} orientation="vertical" style={{ gridColumn: trackIndex * 2 + 2, gridRow: 1 }} onResize={delta => { actions.resizeTracks(trackIndex, delta) }} />
          ))}
        </div>
      )}
    </div>
  )
}
