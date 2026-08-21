// Activity instance body for one child Session. No polling or event copies:
// when the cell and document are visible it mounts the conversation package's
// explicit SessionProvider adapter; otherwise the runtime observation lease
// is released and the child window goes cold.

import { memo, startTransition, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SessionId, SessionProjectionMap } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { ActivityKey } from './locales.ts'
import css from './ActivityPanel.module.css'

type T = (key: ActivityKey, values?: Record<string, unknown>) => string

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
  childId: SessionId
  /** False when the child left the catalog (tab kept until closed). */
  listed: boolean
  visible: boolean
  /** Instance-local chrome belongs to the panel body, never the Workbench header. */
  toolbar: ReactNode
  renderEmbed: (owner: { childSessionId: SessionId }) => ReactNode
  t: T
}

function documentIsVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden'
}

export const SubagentTab = memo(function SubagentTab({
  childId, listed, visible, toolbar, renderEmbed, t,
}: SubagentTabProps) {
  const [pageVisible, setPageVisible] = useState(documentIsVisible)
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = (): void => { setPageVisible(documentIsVisible()) }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { document.removeEventListener('visibilitychange', onVisibility) }
  }, [])
  const eligible = visible && pageVisible
  const [observing, setObserving] = useState(false)
  // Opening a transcript can materialize the official 50-message tail. Keep
  // the Workbench tab/header click responsive by scheduling that mount as
  // concurrent, interruptible content work after the lightweight shell has
  // committed. Closing/hiding still releases the lease immediately.
  useEffect(() => {
    if (!eligible) {
      setObserving(false)
      return
    }
    startTransition(() => { setObserving(true) })
  }, [eligible])

  return (
    <div className={css.tabRoot}>
      <div className={css.instanceToolbar}>{toolbar}</div>
      {!listed && <div className={css.notice}>{t('subagent.gone')}</div>}
      <div className={css.embedBody}>
        {observing ? renderEmbed({ childSessionId: childId }) : null}
      </div>
    </div>
  )
})
