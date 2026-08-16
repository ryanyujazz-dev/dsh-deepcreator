/** Preferences-group row for the default conversation-flow renderer. */

import clsx from 'clsx'
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationRenderMode } from '../../submission-settings.ts'
import type { ConversationKey } from '../locales.ts'
import css from './DefaultRenderModeRow.module.css'

/** Registration-side preference face. */
export interface DefaultRenderModeRowInjected {
  hooks: {
    /** Persisted default bound as useDefaultRenderMode. */
    defaultRenderMode: SnapshotStore<ConversationRenderMode>
  }
  /** Change the user-level fallback renderer. */
  setDefaultRenderMode: (mode: ConversationRenderMode, currentSessionId?: SessionId) => void
}

/** Full Preferences-row props. */
export type DefaultRenderModeRowProps =
  PropsRuntime<'deepcreator.settings.preferences.item'>
  & PropsLocale<'conversation'>
  & InjectFace<DefaultRenderModeRowInjected>

const OPTIONS: readonly { id: ConversationRenderMode; label: ConversationKey }[] = [
  { id: 'normal', label: 'settings.renderMode.normal' },
  { id: 'classic', label: 'settings.renderMode.classic' },
  { id: 'think', label: 'settings.renderMode.think' },
]

/**
 * Render the default conversation-flow renderer selector.
 * @param props - Composed Preferences slot props.
 * @returns the preference row.
 */
export function DefaultRenderModeRow({
  useSessions, useDefaultRenderMode, setDefaultRenderMode, t,
}: DefaultRenderModeRowProps) {
  const selected = useDefaultRenderMode(value => value)
  const currentSessionId = useSessions(state => state.current)
  return (
    <div className={css.row}>
      <div className={css.text}>
        <div className={css.title}>{t('settings.renderMode.title')}</div>
        <div className={css.description}>{t('settings.renderMode.description')}</div>
      </div>
      <div className={css.segmented} role="group" aria-label={t('settings.renderMode.title')}>
        {OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            className={clsx(css.segment, selected === option.id && css.selected)}
            aria-pressed={selected === option.id}
            onClick={() => { setDefaultRenderMode(option.id, currentSessionId) }}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}
