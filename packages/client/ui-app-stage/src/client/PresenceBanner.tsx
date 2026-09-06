/**
 * The presence banner + particle frame + summary card (Px-β client half).
 *
 * Authority lives in the shell layer: the banner is 32 px shell chrome (the
 * Workbench header family), never inside the app viewport, so an app can
 * never paint it. Vocabulary is graded (presence doc §2.3): the micro lease
 * says "AI 正在操作 <app>" (acting); only the macro lease says "AI 接管中"
 * and lights the full four-edge particle frame. Hue carries state only —
 * the authorization source (self vs delegated) rides on wording and frame
 * strength, never on color. No endorsement, no anthropomorphism, no
 * anxiety rhetoric: the banner states who acts and on what, nothing more.
 *
 * The particle frame is a CSS-only field (transform/opacity, will-change,
 * 16 dots — the ambient budget; command freshness raises the cadence).
 * prefers-reduced-motion swaps it for a static 2 px inner border that keeps
 * the same state labels — degradation is explicit, never silent.
 *
 * The live region stays mounted in every state (a region that unmounts with
 * the banner could never announce the end); it stays polite except for
 * "需要你的确认" which is assertive (§3.8). Announcements carry structured
 * fields only — app name and state — never free app text.
 * @module @ryanyujazz/dsh-client-ui-app-stage/client/PresenceBanner
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import type { AppStageKey } from './locales.ts'
import type { PresenceFeedApi, PresenceProjection, PresenceRenderState } from './presence.ts'
import css from './PresenceBanner.module.css'

type Translate = (key: AppStageKey, vars?: Record<string, string>) => string

/** mm:ss for elapsed and remaining readouts (no压迫倒计时 anywhere). */
function clock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** True while a command landed within the burst window (cadence lift, ≤2 s). */
function burst(p: PresenceProjection, now: number): boolean {
  return p.lease !== undefined && now - p.lease.lastCommandAt < 2_000
}

/**
 * Render the banner, the macro particle frame, and the summary card.
 * @param props - the live feed (owned by the shell mount) + the translator.
 * @returns a fragment (the live region renders even when nothing shows).
 */
export function PresenceBanner({ feed, t, now = Date.now }: { feed: PresenceFeedApi; t: Translate; now?: () => number }): ReactElement {
  const p = useSyncExternalStore(feed.subscribe, feed.getSnapshot)
  const lease = p.lease
  const at = now()

  // Structured-field announcements on state transitions only (§3.8): the
  // end message plays because this region never unmounts with the banner.
  const lastState = useRef<PresenceRenderState>('hidden')
  const [announce, setAnnounce] = useState('')
  const [announceAssertive, setAnnounceAssertive] = useState('')
  useEffect(() => {
    if (p.state === lastState.current) return
    const from = lastState.current
    lastState.current = p.state
    const appName = p.lease?.focus?.name ?? ''
    if (p.state === 'waiting-approve') {
      // "需要你的确认" rides the assertive channel (§3.8); everything else
      // stays polite — two regions, because aria-live is fixed per region.
      setAnnounce('')
      setAnnounceAssertive(t('presence.a11y.waiting'))
      return
    }
    setAnnounceAssertive('')
    let message = ''
    if (p.state === 'hidden') message = from === 'hidden' ? '' : t('presence.a11y.ended')
    else if (p.state === 'waiting-user') message = t('presence.a11y.paused')
    else if (p.state === 'taking-over' || (from === 'hidden' && p.lease?.kind === 'macro')) message = t('presence.a11y.takeover-started').replace('{name}', appName)
    else if (from === 'hidden') message = t('presence.a11y.started').replace('{name}', appName)
    if (message !== '') setAnnounce(message)
  }, [p.state, p.lease?.kind, p.lease?.focus?.name, t])

  const liveRegions = (
    <>
      <div className={css.live} role="status" aria-live="polite">{announce}</div>
      <div className={css.live} role="alert">{announceAssertive}</div>
    </>
  )

  if (p.summary !== undefined) {
    const summary = p.summary
    return (
      <>
        {liveRegions}
        <aside className={css.summary} role="status" aria-label={t('presence.summary.title')}>
          <div className={css.summaryHead}>
            <strong className={css.summaryTitle}>{t('presence.summary.title')}</strong>
            <button type="button" className={css.summaryClose} onClick={() => { feed.dismissSummary() }}>{t('presence.summary.close')}</button>
          </div>
          <div className={css.summaryGrid}>
            <span className={css.summaryKey}>{t('presence.summary.duration')}</span>
            <span>{clock(summary.endedAt - summary.startedAt)}</span>
            <span className={css.summaryKey}>{t('presence.summary.actions')}</span>
            <span>{Object.entries(summary.counts).map(([kind, n]) => `${kind} × ${n}`).join(' · ') || '0'}</span>
            <span className={css.summaryKey}>{t('presence.summary.apps')}</span>
            <span>{summary.apps.map(app => app.name).join(' · ') || '—'}</span>
            <span className={css.summaryKey}>{t('presence.summary.keys')}</span>
            <span>{summary.keyChanges.map(change => `${change.appId}:${change.path}`).join(' · ') || '—'}</span>
          </div>
          {summary.userInterrupt !== undefined && (
            <div className={css.summaryInterrupt}>{t('presence.summary.interrupt').replace('{step}', String(summary.userInterrupt.actionsBefore))}</div>
          )}
        </aside>
      </>
    )
  }

  if (lease === undefined || p.state === 'hidden') {
    return <>{liveRegions}</>
  }

  const appName = lease.focus?.name ?? lease.apps[0]?.name ?? ''
  const macro = lease.kind === 'macro'
  const tone = p.state === 'waiting-approve' ? css.bannerApprove : p.state === 'waiting-user' ? css.bannerPaused : macro ? css.bannerMacro : css.bannerMicro

  let line: string
  if (p.state === 'waiting-approve') line = t('presence.waiting-approve').replace('{name}', appName).replace('{version}', lease.waitingApprove?.version ?? '')
  else if (p.state === 'waiting-user') line = t('presence.paused')
  else if (macro) line = lease.delegated ? t('presence.takeover.delegated').replace('{name}', appName) : t('presence.takeover').replace('{name}', appName)
  else line = t('presence.acting').replace('{name}', appName)

  return (
    <>
      {liveRegions}
      <div className={`${css.banner} ${tone} ${p.idle ? css.bannerIdle : ''}`} role="status">
        <span className={`${css.dot} ${macro ? css.dotMacro : ''} ${p.idle ? css.dotIdle : ''} ${burst(p, at) ? css.dotBurst : ''}`} aria-hidden="true" />
        <span className={css.bannerText}>{line}</span>
        {/* The last command's digest (persists after settle until replaced):
            transparent param facts for the lease's lifetime, hidden while
            paused — the waiting-user state says the AI is not acting. */}
        {lease.activeCommand?.paramsSummary !== undefined && lease.activeCommand.paramsSummary.length > 0 && p.state !== 'waiting-user' && (
          <span className={css.paramDigest} aria-hidden="true">
            {lease.activeCommand.paramsSummary.map(pair => (
              <span key={pair.name} className={css.paramPair}>
                <span className={css.paramName}>{pair.name}</span>
                <span className={css.paramValue}>{pair.value}</span>
              </span>
            ))}
          </span>
        )}
        <span className={css.bannerTime} aria-hidden="true">{clock(p.elapsedMs)}</span>
        {p.expiring && p.remainingMs !== undefined && <span className={css.bannerExpiring}>{t('presence.expiring').replace('{time}', clock(p.remainingMs))}</span>}
        <span className={css.bannerActions}>
          {p.state === 'waiting-user' ? (
            <button type="button" className={css.control} onClick={() => { void feed.control('resume') }}>{t('presence.control.resume')}</button>
          ) : macro ? (
            <>
              <button type="button" className={css.control} onClick={() => { void feed.control('interrupt') }}>{t('presence.control.pause')}</button>
              <button type="button" className={css.control} onClick={() => { void feed.control('handback') }}>{t('presence.control.handback')}</button>
            </>
          ) : null}
        </span>
      </div>
      {macro && p.state !== 'waiting-user' && (
        <div className={`${css.frame} ${burst(p, at) ? css.frameBurst : ''} ${p.idle ? css.frameIdle : ''} ${p.state === 'waiting-approve' ? css.frameFrozen : ''}`} aria-hidden="true">
          <div className={`${css.edge} ${css.edgeTop}`}>
            {Array.from({ length: 4 }, (_, i) => <span key={i} className={css.particle} style={{ animationDelay: `${i * 0.45}s` }} />)}
          </div>
          <div className={`${css.edge} ${css.edgeRight}`}>
            {Array.from({ length: 4 }, (_, i) => <span key={i} className={css.particle} style={{ animationDelay: `${i * 0.45 + 0.2}s` }} />)}
          </div>
          <div className={`${css.edge} ${css.edgeBottom}`}>
            {Array.from({ length: 4 }, (_, i) => <span key={i} className={css.particle} style={{ animationDelay: `${i * 0.45 + 0.4}s` }} />)}
          </div>
          <div className={`${css.edge} ${css.edgeLeft}`}>
            {Array.from({ length: 4 }, (_, i) => <span key={i} className={css.particle} style={{ animationDelay: `${i * 0.45 + 0.6}s` }} />)}
          </div>
        </div>
      )}
    </>
  )
}
