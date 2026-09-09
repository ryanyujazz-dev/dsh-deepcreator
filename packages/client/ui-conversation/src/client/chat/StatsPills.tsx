// Official 0.1.5 session statistics presentation: time/speed and token usage
// are two compact pills below the composer, each opening a focused dialog.

import { memo, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconDatabaseOutline16, IconGaugeOutline16 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { UseProjection } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ComposerBarProps } from '../contract/slots.ts'
import { forkT, type ForkTranslate } from '../locales.ts'
import { formatTokensPerSecond } from './message-chrome.ts'
import { billedInputTokens, deriveStats } from './StatsLine.tsx'
import { MEASURE_STYLE, useStatDialog } from './stat-dialog.ts'
import { formatCacheHitPercent, formatExactTokens, formatTokens } from './token-format.ts'
import css from './StatsPills.module.css'
import dialogCss from './stat-dialog.module.css'

export interface StatsPillsProps {
  useChat: SnapshotSelectorHook<ChatSnapshot>
  useProjection: UseProjection
  t: ComposerBarProps['t']
}

function formatDuration(ms: number, t: ForkTranslate): string {
  const seconds = ms / 1_000
  if (seconds < 60) return t('duration.compactSeconds', { seconds: Math.round(seconds * 10) / 10 })
  const whole = Math.round(seconds)
  return t('duration.compactMinutes', {
    minutes: Math.floor(whole / 60),
    seconds: whole % 60,
  })
}

function exactCount(value: number, t: ForkTranslate): string {
  return t('message.turnUsage.count', { count: formatExactTokens(value, t) })
}

type PillDialog = Pick<ReturnType<typeof useStatDialog>, 'open' | 'setOpen'>

function TimePill({ stats, t, dialog }: {
  stats: ReturnType<typeof deriveStats>
  t: ForkTranslate
  dialog: PillDialog
}) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  const counts = t('stats.counts', { turns: stats.turns, steps: stats.steps })
  const speed = stats.decodeMs > 0
    ? t('message.tokensPerSecond', {
      tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
    })
    : null
  const label = (
    <span className={css.label}>
      {counts}
      {speed !== null && <><span className={css.sep} aria-hidden>·</span>{speed}</>}
    </span>
  )
  const hasDetails = stats.llmMs > 0 || stats.toolMs > 0 || stats.ttftSteps > 0 || stats.decodeMs > 0
  if (!hasDetails) {
    return <span className={css.anchor}><span className={css.pill}><IconGaugeOutline16 />{label}</span></span>
  }
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={speed === null ? counts : `${counts} · ${speed}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconGaugeOutline16 />
        {label}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('stats.dialog.title')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}><IconGaugeOutline16 />{t('stats.dialog.title')}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-session-stats-details>
            {stats.llmMs > 0 && <><dt>{t('stats.dialog.llmTime')}</dt><dd>{formatDuration(stats.llmMs, t)}</dd></>}
            {stats.toolMs > 0 && <><dt>{t('stats.dialog.toolTime')}</dt><dd>{formatDuration(stats.toolMs, t)}</dd></>}
            {stats.ttftSteps > 0 && <><dt>{t('stats.dialog.ttft')}</dt><dd>{formatDuration(stats.ttftMs / stats.ttftSteps, t)}</dd></>}
            {stats.decodeMs > 0 && (
              <>
                <dt>{t('stats.dialog.speed')}</dt>
                <dd>{t('message.tokensPerSecond', {
                  tps: formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000)),
                })}</dd>
              </>
            )}
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

function UsagePill({ usage, t, dialog }: {
  usage: TokenUsageProjection
  t: ForkTranslate
  dialog: PillDialog
}) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog(dialog)
  const input = billedInputTokens(usage)
  const total = input + usage.outputTokens
  const totalText = t('message.turnUsage.count', { count: formatTokens(total, t) })
  const cacheHit = formatCacheHitPercent(usage.cacheReadTokens, input)
  const cacheHitText = cacheHit === null ? null : t('stats.cacheHit', { percent: cacheHit })
  return (
    <span ref={rootRef} className={css.anchor}>
      <button
        type="button"
        className={css.pill}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={cacheHitText === null ? totalText : `${totalText} · ${cacheHitText}`}
        onClick={() => { setOpen(!open) }}
      >
        <IconDatabaseOutline16 />
        <span className={css.label}>
          {totalText}
          {cacheHitText !== null && <><span className={css.sep} aria-hidden>·</span>{cacheHitText}</>}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={dialogCss.panel}
          role="dialog"
          aria-label={t('stats.dialog.usageTitle')}
          style={pos ?? MEASURE_STYLE}
        >
          <div className={dialogCss.title}>
            <span className={dialogCss.titleLabel}><IconDatabaseOutline16 />{t('stats.dialog.usageTitle')}</span>
            <span className={dialogCss.titleValue}>{exactCount(total, t)}</span>
          </div>
          <div className={dialogCss.titleRule} aria-hidden />
          <dl className={dialogCss.details} data-session-stats-usage>
            {cacheHit !== null && <><dt>{t('message.turnUsage.cacheHit')}</dt><dd>{cacheHit}%</dd></>}
            <dt>{t('message.turnUsage.input')}</dt><dd>{exactCount(usage.uncachedInputTokens, t)}</dd>
            <dt>{t('message.turnUsage.cacheRead')}</dt><dd>{exactCount(usage.cacheReadTokens, t)}</dd>
            <dt>{t('message.turnUsage.cacheWrite')}</dt><dd>{exactCount(usage.cacheWriteTokens, t)}</dd>
            <dt>{t('message.turnUsage.output')}</dt><dd>{exactCount(usage.outputTokens, t)}</dd>
          </dl>
        </div>,
        document.body,
      )}
    </span>
  )
}

export const StatsPills = memo(function StatsPills({ useChat, useProjection, t: rawT }: StatsPillsProps) {
  const t = forkT(rawT)
  const settledNodes = useChat(snapshot => snapshot.legacy.nodes)
  const usage = useProjection('tokenUsage')
  const projected = useProjection('sessionStats')
  const stats = useMemo(() => projected ?? deriveStats(settledNodes), [projected, settledNodes])
  const [openPill, setOpenPill] = useState<'time' | 'usage' | null>(null)
  const hasTokens = usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)
  if (stats.steps === 0 && !hasTokens) return null
  return (
    <div className={css.root} data-composer-stats>
      {stats.steps > 0 && (
        <TimePill
          stats={stats}
          t={t}
          dialog={{
            open: openPill === 'time',
            setOpen: open => { setOpenPill(open ? 'time' : null) },
          }}
        />
      )}
      {hasTokens && (
        <UsagePill
          usage={usage}
          t={t}
          dialog={{
            open: openPill === 'usage',
            setOpen: open => { setOpenPill(open ? 'usage' : null) },
          }}
        />
      )}
    </div>
  )
})
