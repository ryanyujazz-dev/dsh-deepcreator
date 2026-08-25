// ActivityPanel: the Workbench's live activity home. The Home route is one
// vertical page — this session's subagent catalog (grouped by participation
// in the current turn) plus running/finished background jobs (live-ticking,
// stoppable); every row opens as a real Workbench tab. Subagent instances are
// keyed by child session id and carry a non-navigating occurrence of the
// shared conversation surface; job instances use a namespaced job id and show
// the complete command plus the official live snapshot without consuming the
// job registry's shared output cursor. The panel anchors to the conversation's
// home session: while a subagent is opened in the conversation area, Home
// keeps showing the PARENT's activity instead of re-scoping to the child.
// Nested subagents render EXPANDED by default: each open branch is a level of
// the OFFICIAL per-parent catalog (subagentsByParent), kept live while open,
// so the hierarchy never exists as panel-owned state — only explicit user
// collapses are stored.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type {
  JobView, SessionId, SessionProjectionMap, SubagentAddress, SubagentCatalogSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentOverviewOk } from '@ryanyujazz/dsh-jobs-admin'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { PropsLocale, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the conversation embed slot into the SlotMap.
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import { IconChevronRightOutline14, StateDot } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { formatTokens, SubagentTab, tokenTotal, type SubagentTabProps } from './SubagentTab.tsx'
import type { ActivityInjected } from './injected.ts'
import type { ActivityKey } from './locales.ts'
import css from './ActivityPanel.module.css'

type SessionsListState = {
  byId: Record<SessionId, SessionSummary>
  currentAddress: SubagentAddress | undefined
} & {
  jobsBySession: Record<SessionId, readonly JobView[]>
  subagentsByParent: Record<SessionId, SubagentCatalogSnapshot>
}
type Props = WorkbenchPanelProps & PropsLocale<'workbench-activity'> & ActivityInjected
  & PropsRenderSlots<'deepcreator.conversation.embed'>
type T = PropsLocale<'workbench-activity'>['t']

const EMPTY_JOBS = [] as const
const EMPTY_ENTRIES = [] as const
const JOB_INSTANCE_PREFIX = 'job:'
const EMPTY_COLLAPSED: ReadonlySet<SessionId> = new Set()

/** Namespace a registry job id away from child Session ids in the shared tab set. */
export function jobInstanceId(jobId: string): string { return `${JOB_INSTANCE_PREFIX}${jobId}` }

/** Decode one Activity instance id when it addresses a background job. */
export function jobIdFromInstance(instanceId: string): string | undefined {
  return instanceId.startsWith(JOB_INSTANCE_PREFIX) ? instanceId.slice(JOB_INSTANCE_PREFIX.length) : undefined
}

interface SelectedChildState {
  listed: boolean
  mode: 'one-shot' | 'continuable' | undefined
  running: boolean
  /** Catalog owner the entry was found in — the exact direct-parent address. */
  parentSessionId: SessionId | undefined
}

const equalSelectedChild = (left: SelectedChildState, right: SelectedChildState): boolean => (
  left.listed === right.listed && left.mode === right.mode && left.running === right.running
  && left.parentSessionId === right.parentSessionId
)

const equalLabels = (left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key])
}

/** Per-catalog reference identity: unrelated owners' loads must not re-render branches. */
const equalCatalogs = (
  left: Readonly<Record<string, SubagentCatalogSnapshot>>,
  right: Readonly<Record<string, SubagentCatalogSnapshot>>,
): boolean => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key])
}

const equalUsage = (
  left: SessionProjectionMap['tokenUsage'] | undefined,
  right: SessionProjectionMap['tokenUsage'] | undefined,
): boolean => left === right || (
  left !== undefined && right !== undefined
  && left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens
)

export function stateDot(status: string): 'ongoing' | 'warning' | 'done' | 'error' {
  if (status === 'running') return 'ongoing'
  if (status === 'stopping' || status === 'killed') return 'warning'
  if (status === 'failed') return 'error'
  return 'done'
}

export function isLive(job: Pick<JobView, 'status'>): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Official two-unit elapsed format (hours widest; no day vocabulary). */
export function formatDuration(elapsedMs: number, t: T): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/** Live jobs first in start order, settled newest-first (official ordering). */
function ordered(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((a, b) => {
    const liveA = isLive(a), liveB = isLive(b)
    if (liveA !== liveB) return liveA ? -1 : 1
    if (liveA) return a.startedAt - b.startedAt
    const finished = (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)
    return finished !== 0 ? finished : a.startedAt - b.startedAt
  })
}

export interface SubagentRow {
  id: SessionId
  label: string
  mode: 'one-shot' | 'continuable'
  activity: 'running' | 'inactive'
  /** Official hint: a durable subagent descendant exists below this child. */
  hasChildren: boolean
}

/** Catalog children of one session, in catalog order. */
export function subagentRows(
  catalog: SubagentCatalogSnapshot | undefined,
  byId: Record<SessionId, SessionSummary>,
): SubagentRow[] {
  const entries = catalog?.entries ?? EMPTY_ENTRIES
  const rows: SubagentRow[] = []
  for (const entry of entries) {
    if (entry.kind !== 'child') continue
    rows.push({
      id: entry.id,
      label: entry.label ?? byId[entry.id]?.displayTitle ?? entry.id,
      mode: entry.mode,
      activity: entry.activity,
      hasChildren: entry.hasChildren,
    })
  }
  return rows
}

export interface SubagentCohort {
  /** Children participating since the parent's latest user message (running included). */
  turn: SubagentRow[]
  /** Older children; empty `turn` collapses the split into this one list. */
  earlier: SubagentRow[]
}

/**
 * Derive the currently open nested levels from the official catalogs: every
 * row carrying the `hasChildren` hint, reachable from the home session
 * through open branches only — a collapsed ancestor hides its whole subtree.
 * Branches are open BY DEFAULT; the collapsed set holds explicit opt-outs,
 * so a level that gains its first descendant opens by itself.
 */
export function deriveOpenLevels(
  catalogs: Readonly<Record<string, SubagentCatalogSnapshot>>,
  collapsed: ReadonlySet<SessionId>,
  homeId: SessionId,
): ReadonlySet<SessionId> {
  const open = new Set<SessionId>()
  const visited = new Set<SessionId>([homeId])
  const stack: SessionId[] = [homeId]
  while (stack.length > 0) {
    const parent = stack.pop()!
    for (const entry of catalogs[parent]?.entries ?? EMPTY_ENTRIES) {
      if (entry.kind !== 'child' || !entry.hasChildren) continue
      if (collapsed.has(entry.id) || visited.has(entry.id)) continue
      visited.add(entry.id)
      open.add(entry.id)
      stack.push(entry.id)
    }
  }
  return open
}

/** Running first, then most recently active first (a re-invoked continuable child bumps up). */
function byRecency(rows: SubagentRow[], recency: Map<string, number>): SubagentRow[] {
  const rank = (id: string): number => recency.get(id) ?? Number.NEGATIVE_INFINITY
  return [...rows].sort((a, b) => {
    const running = (a.activity === 'running' ? 0 : 1) - (b.activity === 'running' ? 0 : 1)
    if (running !== 0) return running
    return rank(b.id) > rank(a.id) ? 1 : rank(b.id) < rank(a.id) ? -1 : 0
  })
}

/**
 * Split the catalog children into the current participation cohort and the
 * rest. A child belongs to THIS turn when it is running, or when its latest
 * logged activity postdates the parent's latest user-authored message — a
 * finished-this-turn child stays visible in the cohort; a re-invoked
 * continuable child re-enters at the top with its fresh activity time.
 * Without an overview every row lands in `earlier` (the flat fallback).
 */
export function groupSubagents(
  rows: readonly SubagentRow[],
  overview: SubagentOverviewOk | undefined,
): SubagentCohort {
  if (overview === undefined) return { turn: [], earlier: byRecency([...rows], new Map()) }
  const recency = new Map<string, number>()
  for (const child of overview.children) {
    if (child.lastActiveAt !== undefined) recency.set(child.id, child.lastActiveAt)
  }
  const turn: SubagentRow[] = []
  const earlier: SubagentRow[] = []
  const boundary = overview.turnStartedAt
  for (const row of rows) {
    const lastActiveAt = recency.get(row.id)
    const inTurn = row.activity === 'running'
      || (boundary !== undefined && lastActiveAt !== undefined && lastActiveAt >= boundary)
    ;(inTurn ? turn : earlier).push(row)
  }
  return { turn: byRecency(turn, recency), earlier: byRecency(earlier, recency) }
}

export function ActivityPanel(props: Props) {
  const address = props.useSessions((snapshot: SessionsListState) => snapshot.currentAddress)
  // Anchor to the conversation's home session: while an addressed subagent is
  // current, the Activity panel keeps showing the PARENT's catalog and jobs.
  const homeId = address?.parentSessionId ?? props.sessionId
  // Subagents and jobs share Workbench's instance-tab set. Labels are pure
  // presentation derived from the current official catalog/snapshot; identity
  // remains the child Session id or namespaced registry Job id. Every loaded
  // catalog level contributes — a nested child's tab label must survive even
  // when its branch is collapsed again (the official catalog stays loaded).
  const tabLabels = props.useSessions((snapshot: SessionsListState) => {
    const labels: Record<string, string> = {}
    for (const catalog of Object.values(snapshot.subagentsByParent)) {
      for (const candidate of catalog.entries) {
        if (candidate.kind === 'child') labels[candidate.id] = candidate.label ?? candidate.id
      }
    }
    for (const job of snapshot.jobsBySession[homeId] ?? EMPTY_JOBS) {
      labels[jobInstanceId(job.id)] = job.label
    }
    return labels
  }, equalLabels)
  const contributePanelInfo = props.contributePanelInfo
  useEffect(() => contributePanelInfo({ tabLabels }), [contributePanelInfo, tabLabels])
  if (props.route === 'instance' && props.activeInstanceId !== undefined) {
    const jobId = jobIdFromInstance(props.activeInstanceId)
    if (jobId !== undefined) return <JobInstance {...props} homeId={homeId} jobId={jobId} />
    return <ActivityInstance {...props} homeId={homeId} childId={props.activeInstanceId as SessionId} />
  }
  return <ActivityHome {...props} homeId={homeId} addressedId={address?.childSessionId} />
}

function ActivityHome(props: Props & { homeId: SessionId; addressedId: SessionId | undefined }) {
  const { homeId, addressedId, useSessions, openInstance } = props
  const jobs = useSessions((snapshot: SessionsListState) => snapshot.jobsBySession[homeId]) ?? EMPTY_JOBS
  const catalog = useSessions((snapshot: SessionsListState) => snapshot.subagentsByParent[homeId])
  const byId = useSessions((snapshot: SessionsListState) => snapshot.byId)
  // Every expanded branch level's official catalog, one record. Branch data
  // itself stays in the official store; this selector only re-renders when a
  // relevant catalog object is replaced.
  const catalogs = useSessions(
    (snapshot: SessionsListState) => snapshot.subagentsByParent,
    equalCatalogs,
  )
  const subagents = useMemo(() => subagentRows(catalog, byId), [catalog, byId])
  const [overview, setOverview] = useState<SubagentOverviewOk | undefined>(undefined)
  const cohort = useMemo(() => groupSubagents(subagents, overview), [subagents, overview])
  const visible = props.visible !== false
  const subagentOverview = props.subagentOverview
  // Recency projection, refetched whenever the catalog or job set moves (a
  // delegation registers a job and flips catalog activity); silent on failure
  // — grouping degrades to the flat list.
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void subagentOverview(homeId).then(result => {
      if (cancelled) return
      setOverview(result.ok ? result : undefined)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [homeId, visible, catalog, jobs, subagentOverview])

  // --- Nested-branch disclosure (presentation state only) ---
  // Branches render EXPANDED by default; this set holds only explicit user
  // collapses. Which levels are open is DERIVED from the official catalogs
  // (the `hasChildren` hint) minus this set, so a branch that gains its first
  // descendant opens by itself and the panel never stores the hierarchy.
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionId>>(EMPTY_COLLAPSED)
  // A new home means a different tree; drop the collapse choices (the
  // registration effect below closes the old levels' live subscriptions).
  useEffect(() => { setCollapsed(EMPTY_COLLAPSED) }, [homeId])
  const toggleExpand = (id: SessionId): void => {
    setCollapsed(previous => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next.size === previous.size ? previous : next
    })
  }
  // Levels whose branch is currently open: official expandable hints,
  // reachable from home through open branches only.
  const openLevels = useMemo(
    () => deriveOpenLevels(catalogs, collapsed, homeId),
    [catalogs, collapsed, homeId],
  )
  // Official live-membership registration: while visible, every open level's
  // catalog is marked consumed (new children push refreshes — and a fresh
  // `hasChildren` hint re-opens its branch through the derivation above);
  // hiding the panel or collapsing the branch releases it. The home level
  // registers too: the runtime only refreshes selected or registered
  // catalogs, and while the conversation is drilled into a child the home
  // session is neither — without this, top-level rows would freeze until
  // navigation returns. Diffed, not swept, so an unrelated toggle does not
  // churn other levels' subscriptions.
  const setSubagentCatalogOpen = props.setSubagentCatalogOpen
  const registeredRef = useRef<ReadonlySet<SessionId>>(new Set<SessionId>())
  useEffect(() => {
    const previous = registeredRef.current
    const next = visible ? new Set([...openLevels, homeId]) : new Set<SessionId>()
    for (const id of previous) if (!next.has(id)) setSubagentCatalogOpen(id, false)
    for (const id of next) if (!previous.has(id)) setSubagentCatalogOpen(id, true)
    registeredRef.current = next
  }, [visible, openLevels, homeId, setSubagentCatalogOpen])
  useEffect(() => () => {
    for (const id of registeredRef.current) setSubagentCatalogOpen(id, false)
  }, [setSubagentCatalogOpen])

  return <TasksPage
    sessionId={homeId}
    jobs={jobs}
    cohort={cohort}
    subagentCount={subagents.length}
    addressedId={addressedId}
    openInstance={openInstance}
    closeFromConversation={props.closeFromConversation}
    stopJob={props.stopJob}
    catalogs={catalogs}
    byId={byId}
    openLevels={openLevels}
    onToggleExpand={toggleExpand}
    refreshSubagents={props.refreshSubagents}
    t={props.t}
  />
}

function ActivityInstance(props: Props & { homeId: SessionId; childId: SessionId }) {
  const { homeId, childId, useSessions } = props
  // The tab's child may sit at ANY expanded depth: resolve it against every
  // loaded official catalog (session ids are unique, one owning parent) — a
  // nested child keeps its exact direct-parent address for the jump.
  const child = useSessions((snapshot: SessionsListState): SelectedChildState => {
    for (const [parentKey, catalog] of Object.entries(snapshot.subagentsByParent)) {
      const entry = catalog.entries.find(
        candidate => candidate.kind === 'child' && candidate.id === childId,
      )
      if (entry?.kind === 'child') {
        return {
          listed: true,
          mode: entry.mode,
          running: entry.activity === 'running',
          parentSessionId: parentKey as SessionId,
        }
      }
    }
    return { listed: false, mode: undefined, running: false, parentSessionId: undefined }
  }, equalSelectedChild)
  const summaryRunning = useSessions((snapshot: SessionsListState) => snapshot.byId[childId]?.running === true)
  const usage = useSessions(
    (snapshot: SessionsListState) => snapshot.byId[childId]?.projectionValues?.tokenUsage as
      SessionProjectionMap['tokenUsage'] | undefined,
    equalUsage,
  )
  const { listed, mode, parentSessionId } = child
  const running = child.running || summaryRunning
  const visible = props.visible !== false

  const openInConversation = props.openInConversation
  const showHome = props.showHome
  const t = props.t
  const toolbar = useMemo(() => (
    <div className={css.instanceActions}>
      <StateDot state={running ? 'ongoing' : 'done'} />
      <span className={css.instanceMeta}>
        {mode === undefined
          ? (running ? t('subagent.running') : t('subagent.idle'))
          : `${mode === 'continuable' ? t('subagent.mode.continuable') : t('subagent.mode.one-shot')} · ${running ? t('subagent.running') : t('subagent.idle')}`}
        {usage === undefined ? '' : ` · ${formatTokens(tokenTotal(usage) ?? 0)} tokens`}
      </span>
      <button
        type="button"
        className={css.openButton}
        disabled={!listed}
        title={listed ? undefined : t('subagent.gone')}
        onClick={() => {
          showHome()
          openInConversation({
            parentSessionId: parentSessionId ?? homeId,
            childSessionId: childId,
            mode: mode ?? 'one-shot',
          })
        }}
      >
        {t('subagent.open')}
      </button>
    </div>
  ), [childId, homeId, listed, mode, openInConversation, parentSessionId, running, showHome, t, usage])

  const renderSlot = props.renderSlot
  const renderEmbed = useMemo<SubagentTabProps['renderEmbed']>(
    () => owner => renderSlot('deepcreator.conversation.embed', owner),
    [renderSlot],
  )

  return (
    <SubagentTab
      childId={childId}
      listed={listed}
      visible={visible}
      toolbar={toolbar}
      renderEmbed={renderEmbed}
      t={t}
    />
  )
}

function JobInstance(props: Props & { homeId: SessionId; jobId: string }) {
  const { homeId, jobId, useSessions, stopJob, t } = props
  const job = useSessions((snapshot: SessionsListState) => (
    snapshot.jobsBySession[homeId]?.find(candidate => candidate.id === jobId)
  ))
  const live = job !== undefined && isLive(job)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live || props.visible === false) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [live, props.visible])
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  useEffect(() => { if (!live) setStopping(false) }, [live])

  if (job === undefined) {
    return <div className={css.jobGone}><strong>{t('job.gone.title')}</strong><span>{t('job.gone.body')}</span></div>
  }

  const elapsedMs = (job.finishedAt ?? now) - job.startedAt
  const status = stopping && job.status === 'running' ? t('stopping') : t(job.status as ActivityKey)
  const onStop = (): void => {
    if (!live || stopping) return
    setStopping(true)
    setStopError(null)
    void stopJob(homeId, job.id).then(result => {
      if (result.ok) return
      setStopping(false)
      setStopError(t('stop.failed', { code: result.code }))
    }).catch(() => {
      setStopping(false)
      setStopError(t('stop.failed', { code: 'transport' }))
    })
  }

  return (
    <div className={css.jobInstance}>
      <div className={css.jobToolbar}>
        <StateDot state={stateDot(stopping && job.status === 'running' ? 'stopping' : job.status)} />
        <span className={css.jobToolbarStatus}>{job.kind} · {job.detail ?? status}</span>
        <time>{formatDuration(elapsedMs, t)}</time>
        {live && (
          <button type="button" className={css.stop} disabled={stopping} onClick={onStop}>
            {stopping ? t('stop.stopping') : t('stop')}
          </button>
        )}
      </div>
      {stopError !== null && <div className={css.notice} role="alert">{stopError}</div>}
      <div className={css.jobBody}>
        <section className={css.jobBlock}>
          <h3>{t('job.command')}</h3>
          <pre><code>{job.label}</code></pre>
        </section>
        <dl className={css.jobFacts}>
          <div><dt>{t('job.id')}</dt><dd>{job.id}</dd></div>
          <div><dt>{t('job.kind')}</dt><dd>{job.kind}</dd></div>
          <div><dt>{t('job.status')}</dt><dd>{job.detail ?? status}</dd></div>
          <div><dt>{t('job.duration')}</dt><dd>{formatDuration(elapsedMs, t)}</dd></div>
        </dl>
        <p className={css.jobOutputNote}>{t('job.output.note')}</p>
      </div>
    </div>
  )
}

interface TasksPageProps {
  sessionId: SessionId
  jobs: readonly JobView[]
  cohort: SubagentCohort
  subagentCount: number
  addressedId: SessionId | undefined
  openInstance(instanceId: string): void
  closeFromConversation: ActivityInjected['closeFromConversation']
  stopJob: ActivityInjected['stopJob']
  catalogs: Readonly<Record<string, SubagentCatalogSnapshot>>
  byId: Record<SessionId, SessionSummary>
  openLevels: ReadonlySet<SessionId>
  onToggleExpand(id: SessionId): void
  refreshSubagents: ActivityInjected['refreshSubagents']
  t: T
}

function TasksPage({
  sessionId, jobs, cohort, subagentCount, addressedId, openInstance, closeFromConversation, stopJob,
  catalogs, byId, openLevels, onToggleExpand, refreshSubagents, t,
}: TasksPageProps) {
  const rows = useMemo(() => ordered(jobs), [jobs])
  const live = rows.filter(isLive)
  const settled = rows.filter(job => !isLive(job))
  const liveCount = live.length
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (liveCount === 0) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [liveCount])

  /** Optimistic stopping set — cleared when the snapshot settles the job. */
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [stopError, setStopError] = useState<string | null>(null)
  useEffect(() => {
    const stillOpen = new Set<string>(live.map(job => job.id))
    setStopping(previous => {
      const next = new Set([...previous].filter(id => stillOpen.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [live])
  const onStop = (jobId: string): void => {
    if (stopping.has(jobId)) return
    setStopError(null)
    setStopping(previous => new Set(previous).add(jobId))
    void stopJob(sessionId, jobId).then(result => {
      if (result.ok) return
      setStopping(previous => { const next = new Set(previous); next.delete(jobId); return next })
      setStopError(t('stop.failed', { code: result.code }))
    }).catch(() => {
      setStopping(previous => { const next = new Set(previous); next.delete(jobId); return next })
      setStopError(t('stop.failed', { code: 'transport' }))
    })
  }

  /** Shared per-row props: every home-level row renders as a collapsible branch. */
  const branchProps = {
    parentSessionId: sessionId,
    catalogs, byId, openLevels, onToggleExpand, refreshSubagents,
    openInstance, closeFromConversation, t,
  }
  const empty = rows.length === 0 && subagentCount === 0
  const splitGroups = cohort.turn.length > 0
  return (
    <div className={css.root}>
      {empty && <div className={css.empty}><strong>{t('empty.title')}</strong><span>{t('empty.body')}</span></div>}
      {stopError !== null && <div className={css.notice} role="alert">{stopError}</div>}
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.subagents')}<span>{subagentCount}</span></h3>
        {subagentCount === 0
          ? <div className={css.sectionEmpty}>{t('subagent.empty')}</div>
          : <div className={css.list}>
              {splitGroups && <h4 className={css.groupTitle}>{t('subagent.turn')}<span>{cohort.turn.length}</span></h4>}
              {(splitGroups ? cohort.turn : cohort.earlier).map(row => (
                <SubagentBranch key={row.id} row={row} addressed={addressedId === row.id} {...branchProps} />
              ))}
              {splitGroups && cohort.earlier.length > 0 && (
                <>
                  <h4 className={css.groupTitle}>{t('subagent.earlier')}<span>{cohort.earlier.length}</span></h4>
                  {cohort.earlier.map(row => (
                    <SubagentBranch key={row.id} row={row} addressed={addressedId === row.id} {...branchProps} />
                  ))}
                </>
              )}
            </div>}
      </section>
      {live.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('section.live')}<span>{liveCount}</span></h3>
          <div className={css.list}>
            {live.map(job => (
              <JobRow
                key={job.id}
                job={job}
                now={now}
                stopping={stopping.has(job.id) || job.status === 'stopping'}
                onOpen={() => { openInstance(jobInstanceId(job.id)) }}
                onStop={onStop}
                t={t}
              />
            ))}
          </div>
        </section>
      )}
      {settled.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('section.finished')}<span>{settled.length}</span></h3>
          <div className={css.list}>
            {settled.map(job => (
              <JobRow
                key={job.id}
                job={job}
                now={now}
                stopping={false}
                onOpen={() => { openInstance(jobInstanceId(job.id)) }}
                onStop={onStop}
                t={t}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

interface SubagentCardProps {
  row: SubagentRow
  parentSessionId: SessionId
  addressed: boolean
  /** Official `hasChildren` hint: the row can disclose nested subagents. */
  expandable: boolean
  expanded: boolean
  onToggleExpand(): void
  openInstance(instanceId: string): void
  closeFromConversation: ActivityInjected['closeFromConversation']
  t: T
}

/**
 * One subagent row: opens its tab; the addressed child's meta becomes the
 * return control. Open tabs are NOT highlighted here — a subagent tab stays
 * open for the child's whole lifetime, so an open-tab fill would read as a
 * stuck highlight; the tab strip already shows what is open. A fixed-width
 * leading seat keeps labels aligned whether or not the row can expand; its
 * chevron only toggles the nested branch and never opens the tab.
 */
function SubagentCard({
  row, parentSessionId, addressed, expandable, expanded, onToggleExpand, openInstance, closeFromConversation, t,
}: SubagentCardProps) {
  const onOpen = (): void => { openInstance(row.id) }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={css.subagentRow}
      data-active={row.activity === 'running' || undefined}
      data-addressed={addressed || undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {expandable
        ? (
          <button
            type="button"
            className={css.expandChevron}
            data-open={expanded || undefined}
            aria-expanded={expanded}
            aria-label={expanded ? t('subagent.collapse') : t('subagent.expand')}
            onClick={event => { event.stopPropagation(); onToggleExpand() }}
          >
            <IconChevronRightOutline14 />
          </button>
        )
        : <span className={css.expandSeat} aria-hidden="true" />}
      <StateDot className={css.stateDot} state={row.activity === 'running' ? 'ongoing' : 'done'} />
      <span className={css.subagentLabel} title={row.label}>{row.label}</span>
      {addressed
        ? (
          <button
            type="button"
            className={css.subagentClose}
            onClick={event => { event.stopPropagation(); closeFromConversation(parentSessionId) }}
          >
            {t('subagent.closeConversation')}
          </button>
        )
        : (
          <span className={css.subagentMeta}>
            {row.mode === 'continuable' ? t('subagent.mode.continuable') : t('subagent.mode.one-shot')}
            {' · '}
            {row.activity === 'running' ? t('subagent.running') : t('subagent.idle')}
          </span>
        )}
    </div>
  )
}

interface SubagentBranchProps {
  row: SubagentRow
  parentSessionId: SessionId
  addressed: boolean
  catalogs: Readonly<Record<string, SubagentCatalogSnapshot>>
  byId: Record<SessionId, SessionSummary>
  openLevels: ReadonlySet<SessionId>
  onToggleExpand(id: SessionId): void
  refreshSubagents: ActivityInjected['refreshSubagents']
  openInstance(instanceId: string): void
  closeFromConversation: ActivityInjected['closeFromConversation']
  t: T
}

/**
 * One row plus, when open, its nested children: the next level of the
 * OFFICIAL per-parent catalog rendered under a guide line, recursively. The
 * branch holds no hierarchy state of its own — the open-level set is derived
 * from the official catalogs (open by default) in the Home route.
 */
function SubagentBranch(props: SubagentBranchProps) {
  const { row, openLevels, onToggleExpand } = props
  const isOpen = row.hasChildren && openLevels.has(row.id)
  return (
    <>
      <SubagentCard
        row={row}
        parentSessionId={props.parentSessionId}
        addressed={props.addressed}
        expandable={row.hasChildren}
        expanded={isOpen}
        onToggleExpand={() => { if (row.hasChildren) onToggleExpand(row.id) }}
        openInstance={props.openInstance}
        closeFromConversation={props.closeFromConversation}
        t={props.t}
      />
      {isOpen && (
        <NestedSubagents
          parentId={row.id}
          catalogs={props.catalogs}
          byId={props.byId}
          openLevels={openLevels}
          onToggleExpand={onToggleExpand}
          refreshSubagents={props.refreshSubagents}
          openInstance={props.openInstance}
          closeFromConversation={props.closeFromConversation}
          t={props.t}
        />
      )}
    </>
  )
}

interface NestedSubagentsProps {
  /** The open row whose official catalog holds this level's children. */
  parentId: SessionId
  catalogs: Readonly<Record<string, SubagentCatalogSnapshot>>
  byId: Record<SessionId, SessionSummary>
  openLevels: ReadonlySet<SessionId>
  onToggleExpand(id: SessionId): void
  refreshSubagents: ActivityInjected['refreshSubagents']
  openInstance(instanceId: string): void
  closeFromConversation: ActivityInjected['closeFromConversation']
  t: T
}

/** One open level's body: loading, error, empty, or the child branches. */
function NestedSubagents({ parentId, catalogs, byId, openLevels, onToggleExpand, refreshSubagents, openInstance, closeFromConversation, t }: NestedSubagentsProps) {
  const catalog = catalogs[parentId]
  if (catalog === undefined || catalog.state === 'loading') {
    return <div className={css.nested}><div className={css.nestedStatus}>{t('subagent.children.loading')}</div></div>
  }
  if (catalog.state === 'error') {
    const code = catalog.error?.code ?? 'unknown'
    return (
      <div className={css.nested}>
        <div className={css.nestedStatus}>
          {t('subagent.children.error', { code })}
          <button type="button" className={css.nestedRetry} onClick={() => { void refreshSubagents(parentId) }}>
            {t('subagent.children.retry')}
          </button>
        </div>
      </div>
    )
  }
  const rows = subagentRows(catalog, byId)
  if (rows.length === 0) {
    return <div className={css.nested}><div className={css.nestedStatus}>{t('subagent.children.empty')}</div></div>
  }
  return (
    <div className={css.nested}>
      {rows.map(child => (
        <SubagentBranch
          key={child.id}
          row={child}
          parentSessionId={parentId}
          addressed={false}
          catalogs={catalogs}
          byId={byId}
          openLevels={openLevels}
          onToggleExpand={onToggleExpand}
          refreshSubagents={refreshSubagents}
          openInstance={openInstance}
          closeFromConversation={closeFromConversation}
          t={t}
        />
      ))}
    </div>
  )
}

interface JobRowProps {
  job: JobView
  now: number
  stopping: boolean
  onOpen(): void
  onStop(jobId: string): void
  t: T
}

function JobRow({ job, now, stopping, onOpen, onStop, t }: JobRowProps) {
  const elapsedMs = stopping && job.status === 'running'
    ? now - job.startedAt
    : (job.finishedAt ?? now) - job.startedAt
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
  return (
    <article
      role="button"
      tabIndex={0}
      className={css.row}
      data-live={isLive(job) || undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      <StateDot className={css.stateDot} state={stateDot(job.status)} />
      <div className={css.copy}>
        <strong title={job.label}>{job.label}</strong>
        <span>{job.kind} · {job.detail ?? t(job.status as ActivityKey)}</span>
      </div>
      <div className={css.rowSide}>
        <time>{formatDuration(elapsedMs, t)}</time>
        {isLive(job) && (
          <button
            type="button"
            className={css.stop}
            disabled={stopping}
            aria-label={t('stop')}
            onClick={event => { event.stopPropagation(); onStop(job.id) }}
          >
            {stopping ? t('stop.stopping') : t('stop')}
          </button>
        )}
      </div>
    </article>
  )
}
