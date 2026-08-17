/** Appearance preference group registered into the General settings section. */
import clsx from 'clsx'
import { DiffBlock, type DiffHunk } from '@ryanyujazz/dsh-client-ui-primitives'
import type {
  PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {
  CodeFont, DarkCodeTheme, LightCodeTheme, ThemePreference, TranscriptTextSize,
} from '../theme-settings.ts'
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
  /** Select the syntax theme used while the application is light. */
  setLightCodeTheme: (id: LightCodeTheme) => void
  /** Select the syntax theme used while the application is dark. */
  setDarkCodeTheme: (id: DarkCodeTheme) => void
  /** Select the shared code and terminal font. */
  setCodeFont: (id: CodeFont) => void
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

const LIGHT_CODE_THEME_OPTIONS: readonly { id: LightCodeTheme; labelKey: ThemeKey }[] = [
  { id: 'deepcreator-light', labelKey: 'appearance.code.theme.deepcreatorLight' },
  { id: 'github-light', labelKey: 'appearance.code.theme.githubLight' },
  { id: 'one-light', labelKey: 'appearance.code.theme.oneLight' },
]

const DARK_CODE_THEME_OPTIONS: readonly { id: DarkCodeTheme; labelKey: ThemeKey }[] = [
  { id: 'deepcreator-dark', labelKey: 'appearance.code.theme.deepcreatorDark' },
  { id: 'github-dark', labelKey: 'appearance.code.theme.githubDark' },
  { id: 'one-dark', labelKey: 'appearance.code.theme.oneDark' },
]

const CODE_FONT_OPTIONS: readonly { id: CodeFont; labelKey: ThemeKey }[] = [
  { id: 'system', labelKey: 'appearance.code.font.system' },
  { id: 'jetbrains-mono', labelKey: 'appearance.code.font.jetbrains' },
  { id: 'fira-code', labelKey: 'appearance.code.font.fira' },
  { id: 'source-code-pro', labelKey: 'appearance.code.font.source' },
]

const PREVIEW_DIFF: DiffHunk[] = [{
  path: 'greet.ts',
  oldStart: 1,
  newStart: 1,
  oldText: 'function greet(name: string) {\n  return "Hello, " + name;\n}',
  newText: 'function greet(name: string) {\n  return `Hello, ${name}!`;\n}',
}]

function CodeThemePreview({ themeId, label }: { themeId: LightCodeTheme | DarkCodeTheme; label: string }) {
  return (
    <div className={css.preview} data-code-theme={themeId} aria-label={label}>
      <DiffBlock
        diffs={PREVIEW_DIFF}
        maxLines={8}
        showPath={false}
        showFooter={false}
        variant="preview"
      />
    </div>
  )
}

/**
 * Render the Appearance row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function AppearanceRow({
  t,
  setTheme,
  setTranscriptTextSize,
  setLightCodeTheme,
  setDarkCodeTheme,
  setCodeFont,
  useStore,
}: AppearanceRowComponentProps) {
  const preference = useStore(s => s.preference)
  const transcriptTextSize = useStore(s => s.transcriptTextSize)
  const lightCodeTheme = useStore(s => s.lightCodeTheme)
  const darkCodeTheme = useStore(s => s.darkCodeTheme)
  const codeFont = useStore(s => s.codeFont)
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

      <section className={css.codeAppearance} aria-labelledby="deepcreator-code-appearance-title">
        <div className={css.codeHeading}>
          <div id="deepcreator-code-appearance-title" className={css.settingTitle}>{t('appearance.code.title')}</div>
          <div className={css.settingDescription}>{t('appearance.code.description')}</div>
        </div>
        <div className={css.themeGrid}>
          <label className={css.themeChoice}>
            <span className={css.selectLabel}>{t('appearance.code.light')}</span>
            <select
              className={css.select}
              aria-label={t('appearance.code.light')}
              value={lightCodeTheme}
              onChange={(event) => { setLightCodeTheme(event.currentTarget.value as LightCodeTheme) }}
            >
              {LIGHT_CODE_THEME_OPTIONS.map(option => <option key={option.id} value={option.id}>{t(option.labelKey)}</option>)}
            </select>
            <CodeThemePreview themeId={lightCodeTheme} label={t('appearance.code.preview.light')} />
          </label>
          <label className={css.themeChoice}>
            <span className={css.selectLabel}>{t('appearance.code.dark')}</span>
            <select
              className={css.select}
              aria-label={t('appearance.code.dark')}
              value={darkCodeTheme}
              onChange={(event) => { setDarkCodeTheme(event.currentTarget.value as DarkCodeTheme) }}
            >
              {DARK_CODE_THEME_OPTIONS.map(option => <option key={option.id} value={option.id}>{t(option.labelKey)}</option>)}
            </select>
            <CodeThemePreview themeId={darkCodeTheme} label={t('appearance.code.preview.dark')} />
          </label>
        </div>
        <label className={css.fontChoice}>
          <span className={css.settingText}>
            <span className={css.settingTitle}>{t('appearance.code.font.title')}</span>
            <span className={css.settingDescription}>{t('appearance.code.font.description')}</span>
          </span>
          <select
            className={css.select}
            aria-label={t('appearance.code.font.title')}
            value={codeFont}
            onChange={(event) => { setCodeFont(event.currentTarget.value as CodeFont) }}
          >
            {CODE_FONT_OPTIONS.map(option => <option key={option.id} value={option.id}>{t(option.labelKey)}</option>)}
          </select>
        </label>
      </section>

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
