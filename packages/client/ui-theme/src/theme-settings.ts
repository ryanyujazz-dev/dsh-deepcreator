/** Theme preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Built-in preferences accepted at the registry and settings boundaries. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** Transcript typography sizes exposed by the Appearance settings row. */
export const TRANSCRIPT_TEXT_SIZES = ['small', 'standard', 'large'] as const

/** Settings namespace owned by the theme plugin. */
export const THEME_SETTINGS_NAMESPACE = 'ui-theme'

/** Field carrying the selected built-in theme preference. */
export const THEME_PREFERENCE_FIELD = 'preference'

/** Field carrying the selected transcript typography size. */
export const TRANSCRIPT_TEXT_SIZE_FIELD = 'transcriptTextSize'

/** Theme preference persisted by the product Appearance row. */
export type ThemePreference = typeof THEME_PREFERENCES[number]

/** Transcript typography preference persisted by the product Appearance row. */
export type TranscriptTextSize = typeof TRANSCRIPT_TEXT_SIZES[number]

/** Default preference when the user-settings document has no override. */
export const DEFAULT_PREFERENCE: ThemePreference = 'system'

/** Default transcript typography size when the user has no override. */
export const DEFAULT_TRANSCRIPT_TEXT_SIZE: TranscriptTextSize = 'standard'

/** Durable theme section shared by the Host schema and the browser scope. */
export interface ThemeSettings {
  /** Selected built-in preference. */
  preference: ThemePreference
  /** Selected transcript typography size. */
  transcriptTextSize: TranscriptTextSize
}

/** Durable theme schema; also the wire envelope the browser scope validates against. */
export const ThemeSettingsSchema: z<ThemeSettings> = z.object({
  [THEME_PREFERENCE_FIELD]: z.union([...THEME_PREFERENCES]).default(DEFAULT_PREFERENCE),
  [TRANSCRIPT_TEXT_SIZE_FIELD]: z.union([...TRANSCRIPT_TEXT_SIZES]).default(DEFAULT_TRANSCRIPT_TEXT_SIZE),
})

/**
 * Narrow one wire or registry value to a persistable preference.
 * @param value - value crossing the settings or registry boundary.
 * @returns whether the value is a built-in preference.
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some(preference => preference === value)
}
