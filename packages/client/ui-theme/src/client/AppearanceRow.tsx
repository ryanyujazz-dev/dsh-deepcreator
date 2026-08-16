/** Appearance preference group registered into the General settings section. */
import clsx from 'clsx'
import type {
  PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference, TranscriptTextSize } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@ryanyujazz/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
  /** Switch the transcript typography preference. */
  setTranscriptTextSize: (size: TranscriptTextSize) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'deepcreator.settings.preferences.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Theme option order in the segmented control. */
const THEME_OPTIONS: readonly { id: ThemePreference; labelKey: ThemeKey }[] = [
  { id: 'light', labelKey: 'appearance.light' },
  { id: 'dark', labelKey: 'appearance.dark' },
  { id: 'system', labelKey: 'appearance.system' },
]

/** Transcript option order in the segmented control. */
const TRANSCRIPT_OPTIONS: readonly { id: TranscriptTextSize; labelKey: ThemeKey }[] = [
  { id: 'small', labelKey: 'appearance.transcript.small' },
  { id: 'standard', labelKey: 'appearance.transcript.standard' },
  { id: 'large', labelKey: 'appearance.transcript.large' },
]

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({
  t,
  setTheme,
  setTranscriptTextSize,
  useStore,
}: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const transcriptTextSize = useStore(s => s.transcriptTextSize)
  return (
    <div className={css.rows}>
      <div className={css.settingRow}>
        <div className={css.settingText}>
          <div className={css.settingTitle}>{t('appearance.color.title')}</div>
          <div className={css.settingDescription}>{t('appearance.color.description')}</div>
        </div>
        <div className={css.segmented} role="group" aria-label={t('appearance.color.title')}>
          {THEME_OPTIONS.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.segment, preference === id && css.selected)}
              aria-pressed={preference === id}
              onClick={() => { setTheme(id) }}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className={css.settingRow}>
        <div className={css.settingText}>
          <div className={css.settingTitle}>{t('appearance.interfaceFont.title')}</div>
          <div className={css.settingDescription}>{t('appearance.interfaceFont.description')}</div>
        </div>
        <div className={css.singleValue}>{t('appearance.interfaceFont.system')}</div>
      </div>

      <div className={css.settingRow}>
        <div className={css.settingText}>
          <div className={css.settingTitle}>{t('appearance.transcript.title')}</div>
          <div className={css.settingDescription}>{t('appearance.transcript.description')}</div>
        </div>
        <div className={css.segmented} role="group" aria-label={t('appearance.transcript.title')}>
          {TRANSCRIPT_OPTIONS.map(({ id, labelKey }) => (
            <button
              key={id}
              type="button"
              className={clsx(css.segment, transcriptTextSize === id && css.selected)}
              aria-pressed={transcriptTextSize === id}
              onClick={() => { setTranscriptTextSize(id) }}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

    </div>
  )
}
