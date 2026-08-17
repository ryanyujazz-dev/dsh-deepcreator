import { useMemo, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { StateDot } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type { ActivityKey } from './locales.ts'
import css from './ActivityPanel.module.css'

type Props = WorkbenchPanelProps & PropsLocale<'workbench-activity'>
const EMPTY_JOBS = [] as const

function state(status: string): 'ongoing' | 'warning' | 'done' | 'error' {
  if (status === 'running') return 'ongoing'
  if (status === 'stopping' || status === 'killed') return 'warning'
  if (status === 'failed') return 'error'
  return 'done'
}

function elapsed(startedAt: number, finishedAt: number | undefined, now: number): string {
  const seconds = Math.max(0, Math.floor(((finishedAt ?? now) - startedAt) / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`
}

export function ActivityPanel({ sessionId, useSessions, t }: Props) {
  const jobs = useSessions(snapshot => snapshot.jobsBySession[sessionId]) ?? EMPTY_JOBS
  const [now] = useState(() => Date.now())
  const rows = useMemo(() => [...jobs].sort((a, b) => {
    const liveA = a.status === 'running' || a.status === 'stopping'
    const liveB = b.status === 'running' || b.status === 'stopping'
    if (liveA !== liveB) return liveA ? -1 : 1
    return liveA ? a.startedAt - b.startedAt : (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt)
  }), [jobs])
  const liveCount = rows.filter(job => job.status === 'running' || job.status === 'stopping').length
  if (rows.length === 0) return <div className={css.empty}><strong>{t('empty.title')}</strong><span>{t('empty.body')}</span></div>
  return (
    <div className={css.root}>
      <div className={css.summary}><span>{t('live', { count: liveCount })}</span><span>{t('finished', { count: rows.length - liveCount })}</span></div>
      <div className={css.list}>
        {rows.map(job => (
          <article className={css.row} key={job.id} data-live={job.status === 'running' || job.status === 'stopping' || undefined}>
            <StateDot state={state(job.status)} />
            <div className={css.copy}>
              <strong>{job.label}</strong>
              <span>{job.kind} · {job.detail ?? t(job.status as ActivityKey)}</span>
            </div>
            <time>{elapsed(job.startedAt, job.finishedAt, now)}</time>
          </article>
        ))}
      </div>
    </div>
  )
}
