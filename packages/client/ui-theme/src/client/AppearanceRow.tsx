/** Appearance preference group registered into the General settings section. */
import { useState } from 'react'
import clsx from 'clsx'
import { DiffBlock, IconChevronDownOutline14, Menu, type DiffHunk } from '@ryanyujazz/dsh-client-ui-primitives'
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
  { id: 'catppuccin-light', labelKey: 'appearance.code.theme.catppuccinLight' },
  { id: 'rose-pine-light', labelKey: 'appearance.code.theme.rosePineLight' },
  { id: 'vitesse-light', labelKey: 'appearance.code.theme.vitesseLight' },
  { id: 'kanagawa-light', labelKey: 'appearance.code.theme.kanagawaLight' },
  { id: 'everforest-light', labelKey: 'appearance.code.theme.everforestLight' },
  { id: 'tokyo-night-light', labelKey: 'appearance.code.theme.tokyoNightLight' },
]

const DARK_CODE_THEME_OPTIONS: readonly { id: DarkCodeTheme; labelKey: ThemeKey }[] = [
  { id: 'deepcreator-dark', labelKey: 'appearance.code.theme.deepcreatorDark' },
  { id: 'github-dark', labelKey: 'appearance.code.theme.githubDark' },
  { id: 'one-dark', labelKey: 'appearance.code.theme.oneDark' },
  { id: 'catppuccin-dark', labelKey: 'appearance.code.theme.catppuccinDark' },
  { id: 'rose-pine-dark', labelKey: 'appearance.code.theme.rosePineDark' },
  { id: 'vitesse-dark', labelKey: 'appearance.code.theme.vitesseDark' },
  { id: 'kanagawa-dark', labelKey: 'appearance.code.theme.kanagawaDark' },
  { id: 'everforest-dark', labelKey: 'appearance.code.theme.everforestDark' },
  { id: 'tokyo-night-dark', labelKey: 'appearance.code.theme.tokyoNightDark' },
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
    <div className={css.preview} data-code-theme={themeId} data-code-theme-isolate aria-label={label}>
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

/** One settings selector in the shared house form: a Menu over a borderless
 * trigger button naming the current value (same UI as the agent-preset,
 * language, and permission rows). */
function AppearanceSelector({
  name, selected, options, onSelect, align = 'start',
}: {
  name: string
  selected: string
  options: readonly { id: string; label: string; disabled?: boolean }[]
  onSelect: (id: string) => void
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const selectedOption = options.find(option => option.id === selected)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={options.map(option => (option.disabled === undefined
        ? { id: option.id, label: option.label }
        : { id: option.id, label: option.label, disabled: option.disabled }))}
      selectedId={selected}
      onSelect={(id) => {
        onSelect(id)
        setOpen(false)
      }}
      align={align}
      portal
      anchor={(
        <button
          type="button"
          className={css.selector}
          aria-label={name}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => { setOpen(v => !v) }}
        >
          {selectedOption?.label ?? selected}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}

/** The interface font has one real value today; the rest of the menu is a
 * disabled placeholder until custom interface fonts ship. */
const INTERFACE_FONT_OPTIONS: readonly { id: string; labelKey: ThemeKey; disabled?: boolean }[] = [
  { id: 'system', labelKey: 'appearance.interfaceFont.system' },
  { id: 'custom', labelKey: 'appearance.interfaceFont.custom', disabled: true },
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
          <div className={css.themeChoice}>
            <span className={css.selectLabel}>{t('appearance.code.light')}</span>
            <AppearanceSelector
              name={t('appearance.code.light')}
              selected={lightCodeTheme}
              options={LIGHT_CODE_THEME_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) }))}
              onSelect={(id) => { setLightCodeTheme(id as LightCodeTheme) }}
            />
            <CodeThemePreview themeId={lightCodeTheme} label={t('appearance.code.preview.light')} />
          </div>
          <div className={css.themeChoice}>
            <span className={css.selectLabel}>{t('appearance.code.dark')}</span>
            <AppearanceSelector
              name={t('appearance.code.dark')}
              selected={darkCodeTheme}
              options={DARK_CODE_THEME_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) }))}
              onSelect={(id) => { setDarkCodeTheme(id as DarkCodeTheme) }}
            />
            <CodeThemePreview themeId={darkCodeTheme} label={t('appearance.code.preview.dark')} />
          </div>
        </div>
        <div className={css.fontChoice}>
          <div className={css.settingText}>
            <span className={css.settingTitle}>{t('appearance.code.font.title')}</span>
            <span className={css.settingDescription}>{t('appearance.code.font.description')}</span>
          </div>
          <AppearanceSelector
            name={t('appearance.code.font.title')}
            selected={codeFont}
            options={CODE_FONT_OPTIONS.map(option => ({ id: option.id, label: t(option.labelKey) }))}
            onSelect={(id) => { setCodeFont(id as CodeFont) }}
            align="end"
          />
        </div>
      </section>

      <div className={css.settingRow}>
        <div className={css.settingText}>
          <div className={css.settingTitle}>{t('appearance.interfaceFont.title')}</div>
          <div className={css.settingDescription}>{t('appearance.interfaceFont.description')}</div>
        </div>
        <AppearanceSelector
          name={t('appearance.interfaceFont.title')}
          selected="system"
          options={INTERFACE_FONT_OPTIONS.map(option => (option.disabled === undefined
            ? { id: option.id, label: t(option.labelKey) }
            : { id: option.id, label: t(option.labelKey), disabled: option.disabled }))}
          onSelect={() => {}}
          align="end"
        />
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
