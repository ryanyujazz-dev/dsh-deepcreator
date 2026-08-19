// ActivityPanel: the Workbench's live activity home. The Home route is one
// vertical page — running/finished background jobs (live-ticking, stoppable)
// plus this session's subagent catalog; each subagent opens as a real
// Workbench tab (a panel instance keyed by the child session id) carrying the
// embedded classic-mode execution flow and its floating queue card.

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  JobView, SessionId, SubagentCatalogSnapshot, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRenderSlots, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the conversation embed slot into the SlotMap.
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import { StateDot } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import { SubagentTab, type SubagentTabProps } from './SubagentTab.tsx'
import type { ActivityInjected } from './injected.ts'
import type { ActivityKey } from './locales.ts'
import css from './ActivityPanel.module.css'

type SessionsListState = { byId: Record<SessionId, SessionSummary> } & {
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

/** Catalog children of the current session: running first, then idle. */
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
  return rows.sort((a, b) => (a.activity === b.activity ? 0 : a.activity === 'running' ? -1 : 1))
}

export function ActivityPanel(props: Props) {
  const { sessionId, useSessions, route, tabs, activeInstanceId, openInstance } = props
  const jobs = useSessions((snapshot: SessionsListState) => snapshot.jobsBySession[sessionId]) ?? EMPTY_JOBS
  const catalog = useSessions((snapshot: SessionsListState) => snapshot.subagentsByParent[sessionId])
  const byId = useSessions((snapshot: SessionsListState) => snapshot.byId)
  const subagents = useMemo(() => subagentRows(catalog, byId), [catalog, byId])
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
        parentSessionId={sessionId}
        childId={activeInstanceId as SessionId}
        label={row?.label}
        mode={row?.mode}
        activity={row?.activity}
        listed={row !== undefined}
        useSessions={useSessions as SnapshotSelectorHook<SessionsListState>}
        visible={props.visible !== false}
        subagentEvents={props.subagentEvents}
        openInConversation={props.openInConversation}
        renderEmbed={renderEmbed}
        t={props.t}
      />
    )
  }
  return <TasksPage
    sessionId={sessionId}
    jobs={jobs}
    subagents={subagents}
    openTabs={tabs}
    openInstance={openInstance}
    stopJob={props.stopJob}
    t={props.t}
  />
}

interface TasksPageProps {
  sessionId: SessionId
  jobs: readonly JobView[]
  subagents: readonly SubagentRow[]
  openTabs: readonly string[]
  openInstance(instanceId: string): void
  stopJob: ActivityInjected['stopJob']
  t: T
}

function TasksPage({ sessionId, jobs, subagents, openTabs, openInstance, stopJob, t }: TasksPageProps) {
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

  const empty = rows.length === 0 && subagents.length === 0
  return (
    <div className={css.root}>
      {empty && <div className={css.empty}><strong>{t('empty.title')}</strong><span>{t('empty.body')}</span></div>}
      {stopError !== null && <div className={css.notice} role="alert">{stopError}</div>}
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
      <section className={css.section}>
        <h3 className={css.sectionTitle}>{t('section.subagents')}<span>{subagents.length}</span></h3>
        {subagents.length === 0
          ? <div className={css.sectionEmpty}>{t('subagent.empty')}</div>
          : <div className={css.list}>
              {subagents.map(row => (
                <button
                  type="button"
                  key={row.id}
                  className={css.subagentRow}
                  data-open={openTabs.includes(row.id) || undefined}
                  data-active={row.activity === 'running' || undefined}
                  onClick={() => { openInstance(row.id) }}
                >
                  <StateDot className={css.stateDot} state={row.activity === 'running' ? 'ongoing' : 'done'} />
                  <span className={css.subagentLabel}>{row.label}</span>
                  <span className={css.subagentMeta}>
                    {row.mode === 'continuable' ? t('subagent.mode.continuable') : t('subagent.mode.one-shot')}
                    {' · '}
                    {row.activity === 'running' ? t('subagent.running') : t('subagent.idle')}
                  </span>
                </button>
              ))}
            </div>}
      </section>
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
