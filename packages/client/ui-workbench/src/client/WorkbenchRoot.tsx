import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { WorkbenchPanelShell } from '@ryanyujazz/dsh-client-ui-primitives'
import type {
  PanelTypeDefinition, WorkbenchPanelHeaderContribution, WorkbenchPanelInfoContribution, WorkbenchPanelOwnerProps, WorkbenchRootProps,
} from './contract.ts'
import type { WorkbenchGroupState } from './store.ts'
import type { WorkbenchCommand } from './service.ts'
import { visibleTrackCount } from './layout.ts'
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
        onResize(increment ? 16 : -16)
      }}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        last.current = orientation === 'vertical' ? event.clientX : event.clientY
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId) || last.current === null) return
        const current = orientation === 'vertical' ? event.clientX : event.clientY
        onResize(current - last.current)
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
  group, definition, focused, visible, reveal, renderPanel, renderArtifact, onHide, onFocus, onRestore, actions, t,
}: {
  group: WorkbenchGroupState
  definition: PanelTypeDefinition | undefined
  focused: boolean
  /** Whether the group's cell is rendered (hidden groups stay mounted). */
  visible: boolean
  /** Pending reveal target when the latest command addressed this type. */
  reveal: WorkbenchPanelOwnerProps['reveal']
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
  const [panelInfo, setPanelInfo] = useState<WorkbenchPanelInfoContribution>({})
  const panelInfoSequence = useRef(0)
  const contributePanelInfo = useCallback((contribution: WorkbenchPanelInfoContribution) => {
    const sequence = ++panelInfoSequence.current
    setPanelInfo(contribution)
    return () => {
      if (panelInfoSequence.current !== sequence) return
      setPanelInfo({})
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
    contributePanelInfo,
    renderArtifact,
    visible,
    ...(reveal === undefined ? {} : { reveal }),
  }
  return (
    <WorkbenchPanelShell
      typeId={group.typeId}
      label={label}
      route={group.activeRoute}
      tabs={group.tabs}
      tabLabels={panelInfo.tabLabels}
      tabFilePaths={panelInfo.tabFilePaths}
      titleSuffix={panelInfo.titleSuffix}
      {...(group.activeInstanceId === undefined ? {} : { activeInstanceId: group.activeInstanceId })}
      supportsHome={definition?.supportsHome === true}
      focused={focused}
      backLabel={t('back', { type: label })}
      focusLabel={t('focus')}
      restoreLabel={t('restore')}
      closeGroupLabel={t('closeGroup', { type: label })}
      closeTabLabel={tab => t('closeTab', { tab: panelInfo.tabLabels?.[tab] ?? tab })}
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
  // Commands are edge-triggered events, even though the controller retains
  // the latest one as a useSyncExternalStore snapshot. A new session-scoped
  // root starts at the current sequence watermark so it never replays the
  // previous session's final panel action during first-message activation.
  const commandFloor = useRef(command?.sequence ?? 0)
  const processed = useRef(commandFloor.current)
  // The reveal target rides the latest command into render: panels consume it
  // from an effect keyed on the nonce, so it does not need store persistence.
  const revealCommand = command !== null
    && command.sequence > commandFloor.current
    && command.action.kind === 'present'
    && command.action.request.target !== undefined
    ? { typeId: command.action.request.typeId, target: command.action.request.target, nonce: command.sequence }
    : null
  const dragStart = useRef<number | null>(null)
  const tracksRef = useRef<HTMLDivElement | null>(null)
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

  // Splitter tracks are zero-width: the 8px transparent hit zones center over
  // the 4px+4px margin gap between cards instead of reserving layout space, so
  // the full card-to-card gap stays grabbable.
  const gridTemplateColumns = focusedTypeId === null
    ? responsiveTracks.flatMap((track, index) => index === responsiveTracks.length - 1
      ? [`minmax(0, ${track.width}fr)`]
      : [`minmax(0, ${track.width}fr)`, '0px']).join(' ')
    : 'minmax(0, 1fr)'

  return (
    <div className={css.root} data-focused={focusedTypeId !== null || undefined} data-visible-tracks={responsiveTrackCount}>
      {shownTypeIds.length === 0 && <div className={css.empty}>{t('empty')}</div>}
      {groups.length > 0 && (
        <div ref={tracksRef} className={css.tracks} aria-hidden={shownTypeIds.length === 0 || undefined} style={{ gridTemplateColumns }}>
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
                ? { gridColumn: column, gridRow: 1, alignSelf: 'start', height: `${firstFraction * 100}%`, display: visible ? undefined : 'none' }
                : { gridColumn: column, gridRow: 1, alignSelf: 'end', height: `${(1 - firstFraction) * 100}%`, display: visible ? undefined : 'none' }
            return (
              <div className={css.cell} key={group.typeId} style={cellStyle}>
                  <Group
                    group={group}
                    definition={definitionById.get(group.typeId)}
                    focused={focusedTypeId === group.typeId}
                    visible={visible}
                    reveal={revealCommand !== null && revealCommand.typeId === group.typeId
                      ? { target: revealCommand.target, nonce: revealCommand.nonce }
                      : undefined}
                    actions={actions}
                    t={t}
                    onHide={() => { actions.hide(group.typeId) }}
                    onFocus={() => { actions.focus(group.typeId) }}
                    onRestore={() => { actions.restoreFocus() }}
                    renderPanel={(owner) => renderSlot('deepcreator.workbench.panel', owner, { only: group.typeId })}
                    renderArtifact={(artifact) => renderSlot('deepcreator.workbench.artifact.renderer', artifact, {
                      ...(artifact.kind === undefined ? {} : { only: artifact.kind }),
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
            return <Splitter key={`cell:${trackIndex}`} className={css.cellSplitter} orientation="horizontal" style={{ gridColumn: trackIndex * 2 + 1, gridRow: 1, alignSelf: 'start', position: 'relative', top: `calc(${fraction * 100}% - 4px)` }} onResize={delta => {
              // Cell heights are fractions of the column: convert the raw
              // pointer travel into a ratio against the live column height so
              // the boundary tracks the cursor 1:1 at any panel size.
              const height = tracksRef.current?.getBoundingClientRect().height ?? 0
              actions.resizeCells(trackIndex, 0, height > 0 ? delta / height : 0)
            }} />
          })}
          {focusedTypeId === null && responsiveTracks.slice(0, -1).map((_track, trackIndex) => (
            <Splitter key={`track:${trackIndex}`} className={css.trackSplitter} orientation="vertical" style={{ gridColumn: trackIndex * 2 + 2, gridRow: 1 }} onResize={delta => {
              // Columns share the available width proportionally to their fr
              // weights; scale the pointer delta by stored/rendered so the
              // boundary follows the cursor even while responsive hiding
              // leaves visible stored widths ≠ rendered pixels.
              const visible = responsiveTracks.reduce((sum, track) => sum + track.width, 0)
              const available = Math.max(0, width - 8)
              actions.resizeTracks(trackIndex, visible > 0 && available > 0 ? delta * visible / available : delta)
            }} />
          ))}
        </div>
      )}
    </div>
  )
}
