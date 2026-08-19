// SubagentTab: the Activity panel's instance route for one subagent child —
// the embedded classic-mode execution flow (through the official assembler,
// via the conversation embed slot) plus the official jump into the
// conversation area. Closing the tab is view-only: the child keeps running.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId, SessionProjectionMap, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the tokenUsage key into SessionProjectionMap.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { StateDot } from '@ryanyujazz/dsh-client-ui-primitives'
import type { ActivityInjected } from './injected.ts'
import type { ActivityKey } from './locales.ts'
import css from './ActivityPanel.module.css'

type T = (key: ActivityKey, values?: Record<string, unknown>) => string
/**
 * Adaptive streaming cadence while a child runs. The wire carries token
 * `assistant/chunk` deltas, so the poll CHASES the stream: any poll that
 * returned events re-polls after the fast interval (visually token-paced,
 * matching the main conversation), while quiet polls back off toward the
 * ceiling (tool execution, long thinking). Idle children fetch once and stop.
 */
const FAST_POLL_MS = 120
const IDLE_POLL_CEILING_MS = 400

/** Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits). */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Sum the four disjoint durable provider-usage buckets. */
export function tokenTotal(usage: SessionProjectionMap['tokenUsage'] | undefined): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

export interface SubagentTabProps {
  parentSessionId: SessionId
  childId: SessionId
  label: string | undefined
  mode: 'one-shot' | 'continuable' | undefined
  activity: 'running' | 'inactive' | undefined
  /** False when the child left the catalog (tab kept until closed). */
  listed: boolean
  useSessions: SnapshotSelectorHook<{ byId: Record<SessionId, SessionSummary> }>
  visible: boolean
  subagentEvents: ActivityInjected['subagentEvents']
  openInConversation: ActivityInjected['openInConversation']
  /** Workbench route back to the panel's home (used after the conversation-area jump). */
  showHome(): void
  /** Embed-slot dispatch supplied by the panel entry's children declaration. */
  renderEmbed: (owner: {
    parentSessionId: SessionId
    childSessionId: SessionId
    events: readonly unknown[]
    queue: readonly { id: string; placement: 'queued' | 'steering'; message: unknown }[]
    running: boolean
  }) => ReactNode
  t: T
}

interface Window {
  events: unknown[]
  queue: { id: string; placement: 'queued' | 'steering'; message: unknown }[]
  totalSeq: number
}

export function SubagentTab({
  parentSessionId, childId, label, mode, activity, listed, useSessions, visible,
  subagentEvents, openInConversation, showHome, renderEmbed, t,
}: SubagentTabProps) {
  const summary = useSessions(snapshot => snapshot.byId[childId])
  // Union of the two live facts: the catalog's activity bit and the session
  // summary's running flag. Either alone can lag the other at a turn edge.
  const catalogRunning = activity === 'running' || summary?.running === true
  const [flowing, setFlowing] = useState(false)
  const [frame, setFrame] = useState<Window | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pull the raw event window: a full slice first, then `afterSeq` deltas on
  // a slow cadence while the child runs and the group is actually rendered
  // (contract: hidden groups stay mounted, so polling gates on `visible`).
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    let timer: number | undefined
    let cursor: number | undefined
    /** Adaptive backoff: fast while deltas land, relaxing when quiet. */
    let delay = FAST_POLL_MS
    const schedule = (hadEvents: boolean): void => {
      if (!catalogRunning) return
      delay = hadEvents ? FAST_POLL_MS : Math.min(delay * 2, IDLE_POLL_CEILING_MS)
      timer = window.setTimeout(pull, delay)
    }
    const pull = (): void => {
      const initial = cursor === undefined
      void subagentEvents(parentSessionId, childId, cursor).then(result => {
        if (cancelled) return
        if (result.ok) {
          setError(null)
          const delta = result.events
          cursor = result.totalSeq
          setFrame(previous => ({
            events: initial ? [...delta] : [...(previous?.events ?? []), ...delta],
            queue: result.queue,
            totalSeq: result.totalSeq,
          }))
          // Only a DELTA proves live production: the initial window always
          // carries history, so it must not light the drafting indicator.
          setFlowing(!initial && delta.length > 0)
          schedule(delta.length > 0)
        } else {
          setError(t('events.error', { code: result.code }))
          schedule(false)
        }
      }).catch(() => {
        if (cancelled) return
        schedule(false)
      })
    }
    pull()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [childId, parentSessionId, catalogRunning, subagentEvents, t, visible])

  // The turn-level drafting indicator must not wait for the catalog bit: a
  // child that is visibly producing events is "running" to the reader even
  // while both activity flags still say idle (the spawn/delivery window).
  const running = catalogRunning || flowing

  return (
    <div className={css.tabRoot}>
      <header className={css.tabHeader}>
        <StateDot className={css.stateDot} state={running ? 'ongoing' : 'done'} />
        <div className={css.tabCopy}>
          <strong title={label ?? childId}>{label ?? childId}</strong>
          <span>
            {mode === undefined
              ? ''
              : `${mode === 'continuable' ? t('subagent.mode.continuable') : t('subagent.mode.one-shot')} · `}
            {running ? t('subagent.running') : t('subagent.idle')}
            {summary?.projectionValues?.tokenUsage !== undefined
              ? ` · ${formatTokens(tokenTotal(summary.projectionValues.tokenUsage) ?? 0)} tokens`
              : ''}
          </span>
        </div>
        <button
          type="button"
          className={css.openButton}
          disabled={!listed}
          title={listed ? undefined : t('subagent.gone')}
          onClick={() => {
            // Home first, while the PARENT's workbench instance still owns
            // the action; the jump then re-scopes the session.
            showHome()
            openInConversation({ parentSessionId, childSessionId: childId, mode: mode ?? 'one-shot' })
          }}
        >
          {t('subagent.open')}
        </button>
      </header>
      {!listed && <div className={css.notice}>{t('subagent.gone')}</div>}
      {error !== null && <div className={css.notice} role="alert">{error}</div>}
      <div className={css.embedBody}>
        {renderEmbed({
          parentSessionId,
          childSessionId: childId,
          events: frame?.events ?? [],
          queue: frame?.queue ?? [],
          running,
        })}
      </div>
    </div>
  )
}
