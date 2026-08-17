/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Transcript typography sizes exposed by the Appearance settings row. */
export const TRANSCRIPT_TEXT_SIZES = ['small', 'standard', 'large'] as const
export const LIGHT_CODE_THEMES = ['deepcreator-light', 'github-light', 'one-light'] as const
export const DARK_CODE_THEMES = ['deepcreator-dark', 'github-dark', 'one-dark'] as const
export const CODE_FONTS = ['system', 'jetbrains-mono', 'fira-code', 'source-code-pro'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the selected transcript typography size. */
export const TRANSCRIPT_TEXT_SIZE_FIELD = 'transcriptTextSize'
export const LIGHT_CODE_THEME_FIELD = 'lightCodeTheme'
export const DARK_CODE_THEME_FIELD = 'darkCodeTheme'
export const CODE_FONT_FIELD = 'codeFont'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Transcript typography preference persisted by the product Appearance row. */
export type TranscriptTextSize = typeof TRANSCRIPT_TEXT_SIZES[number]
export type LightCodeTheme = typeof LIGHT_CODE_THEMES[number]
export type DarkCodeTheme = typeof DARK_CODE_THEMES[number]
export type CodeFont = typeof CODE_FONTS[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Default transcript typography size when the user has no override. */
export const DEFAULT_TRANSCRIPT_TEXT_SIZE: TranscriptTextSize = 'standard'
export const DEFAULT_LIGHT_CODE_THEME: LightCodeTheme = 'deepcreator-light'
export const DEFAULT_DARK_CODE_THEME: DarkCodeTheme = 'deepcreator-dark'
export const DEFAULT_CODE_FONT: CodeFont = 'system'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Selected transcript typography size. */
  transcriptTextSize: TranscriptTextSize
  lightCodeTheme: LightCodeTheme
  darkCodeTheme: DarkCodeTheme
  codeFont: CodeFont
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [TRANSCRIPT_TEXT_SIZE_FIELD]: z.union([...TRANSCRIPT_TEXT_SIZES]).default(DEFAULT_TRANSCRIPT_TEXT_SIZE),
  [LIGHT_CODE_THEME_FIELD]: z.union([...LIGHT_CODE_THEMES]).default(DEFAULT_LIGHT_CODE_THEME),
  [DARK_CODE_THEME_FIELD]: z.union([...DARK_CODE_THEMES]).default(DEFAULT_DARK_CODE_THEME),
  [CODE_FONT_FIELD]: z.union([...CODE_FONTS]).default(DEFAULT_CODE_FONT),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}

export function isLightCodeTheme(value: unknown): value is LightCodeTheme {
  return LIGHT_CODE_THEMES.some(theme => theme === value)
}

export function isDarkCodeTheme(value: unknown): value is DarkCodeTheme {
  return DARK_CODE_THEMES.some(theme => theme === value)
}

export function isCodeFont(value: unknown): value is CodeFont {
  return CODE_FONTS.some(font => font === value)
}
