// ActivityPanel: the Workbench's live activity home. The Home route is one
// vertical page — this session's subagent catalog (grouped by participation
// in the current turn) plus running/finished background jobs (live-ticking,
// stoppable); each subagent opens as a real Workbench tab (a panel instance
// keyed by the child session id) carrying the embedded classic-mode execution
// flow and its floating queue card. The panel anchors to the conversation's
// home session: while a subagent is opened in the conversation area, Home
// keeps showing the PARENT's activity instead of re-scoping to the child.

import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type {
  JobView, SessionId, SubagentAddress, SubagentCatalogSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SubagentOverviewOk } from '@ryanyujazz/dsh-jobs-admin'
import type { PropsLocale, PropsRenderSlots, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the conversation embed slot into the SlotMap.
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import { StateDot } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { SubagentTab, type SubagentTabProps } from './SubagentTab.tsx'
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
  const { sessionId, useSessions, route, activeInstanceId, openInstance } = props
  const address = useSessions((snapshot: SessionsListState) => snapshot.currentAddress)
  // Anchor to the conversation's home session: while an addressed subagent is
  // current, the Activity panel keeps showing the PARENT's catalog and jobs.
  const homeId = address?.parentSessionId ?? sessionId
  const jobs = useSessions((snapshot: SessionsListState) => snapshot.jobsBySession[homeId]) ?? EMPTY_JOBS
  const catalog = useSessions((snapshot: SessionsListState) => snapshot.subagentsByParent[homeId])
  const byId = useSessions((snapshot: SessionsListState) => snapshot.byId)
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
  const renderEmbed = useMemo<(owner: SubagentTabProps['renderEmbed'] extends (o: infer O) => ReactNode ? O : never) => ReactNode>(
    () => owner => props.renderSlot('deepcreator.conversation.embed', owner),
    [props.renderSlot],
  )

  // Tab pills carry the catalog label; the instance id stays the child id.
  useEffect(() => {
    const tabLabels: Record<string, string> = {}
    for (const row of subagents) tabLabels[row.id] = row.label
    return props.contributePanelInfo({ tabLabels })
  }, [props, subagents])

  if (route === 'instance' && activeInstanceId !== undefined) {
    const row = subagents.find(candidate => candidate.id === activeInstanceId)
    return (
      <SubagentTab
        parentSessionId={homeId}
        childId={activeInstanceId as SessionId}
        label={row?.label}
        mode={row?.mode}
        activity={row?.activity}
        listed={row !== undefined}
        useSessions={useSessions as SnapshotSelectorHook<SessionsListState>}
        visible={visible}
        subagentEvents={props.subagentEvents}
        openInConversation={props.openInConversation}
        showHome={props.showHome}
        renderEmbed={renderEmbed}
        t={props.t}
      />
    )
  }
  return <TasksPage
    sessionId={homeId}
    jobs={jobs}
    cohort={cohort}
    subagentCount={subagents.length}
    addressedId={address?.childSessionId}
    openInstance={openInstance}
    closeFromConversation={props.closeFromConversation}
    stopJob={props.stopJob}
    t={props.t}
  />
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
  t: T
}

function TasksPage({
  sessionId, jobs, cohort, subagentCount, addressedId, openInstance, closeFromConversation, stopJob, t,
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
                <SubagentCard
                  key={row.id}
                  row={row}
                  parentSessionId={sessionId}
                  addressed={addressedId === row.id}
                  openInstance={openInstance}
                  closeFromConversation={closeFromConversation}
                  t={t}
                />
              ))}
              {splitGroups && cohort.earlier.length > 0 && (
                <>
                  <h4 className={css.groupTitle}>{t('subagent.earlier')}<span>{cohort.earlier.length}</span></h4>
                  {cohort.earlier.map(row => (
                    <SubagentCard
                      key={row.id}
                      row={row}
                      parentSessionId={sessionId}
                      addressed={addressedId === row.id}
                      openInstance={openInstance}
                      closeFromConversation={closeFromConversation}
                      t={t}
                    />
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
              <JobRow key={job.id} job={job} now={now} stopping={stopping.has(job.id) || job.status === 'stopping'} onStop={onStop} t={t} />
            ))}
          </div>
        </section>
      )}
      {settled.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{t('section.finished')}<span>{settled.length}</span></h3>
          <div className={css.list}>
            {settled.map(job => <JobRow key={job.id} job={job} now={now} stopping={false} onStop={onStop} t={t} />)}
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
  openInstance(instanceId: string): void
  closeFromConversation: ActivityInjected['closeFromConversation']
  t: T
}

/**
 * One subagent row: opens its tab; the addressed child's meta becomes the
 * return control. Open tabs are NOT highlighted here — a subagent tab stays
 * open for the child's whole lifetime, so an open-tab fill would read as a
 * stuck highlight; the tab strip already shows what is open.
 */
function SubagentCard({ row, parentSessionId, addressed, openInstance, closeFromConversation, t }: SubagentCardProps) {
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

interface JobRowProps {
  job: JobView
  now: number
  stopping: boolean
  onStop(jobId: string): void
  t: T
}

function JobRow({ job, now, stopping, onStop, t }: JobRowProps) {
  const elapsedMs = stopping && job.status === 'running'
    ? now - job.startedAt
    : (job.finishedAt ?? now) - job.startedAt
  return (
    <article className={css.row} data-live={isLive(job) || undefined}>
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
            onClick={() => { onStop(job.id) }}
          >
            {stopping ? t('stop.stopping') : t('stop')}
          </button>
        )}
      </div>
    </article>
  )
}
