/** Host registration for the browser theme preference and pre-plugin palette. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { injectBootTheme } from './boot-theme.ts'
import {
  DEFAULT_PREFERENCE, THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema,
  type ThemePreference, type ThemeSettings,
} from './theme-settings.ts'

export {
  CODE_FONT_FIELD, CODE_FONTS, DARK_CODE_THEME_FIELD, DARK_CODE_THEMES,
  DEFAULT_CODE_FONT, DEFAULT_DARK_CODE_THEME, DEFAULT_LIGHT_CODE_THEME,
  DEFAULT_PREFERENCE, DEFAULT_TRANSCRIPT_TEXT_SIZE,
  LIGHT_CODE_THEME_FIELD, LIGHT_CODE_THEMES,
  THEME_PREFERENCE_FIELD, THEME_PREFERENCES, THEME_SETTINGS_NAMESPACE,
  TRANSCRIPT_TEXT_SIZE_FIELD, TRANSCRIPT_TEXT_SIZES,
  type CodeFont, type DarkCodeTheme, type LightCodeTheme,
  type ThemePreference, type ThemeSettings, type TranscriptTextSize,
} from './theme-settings.ts'

const THEME_NAMESPACE = settingsNamespace(THEME_SETTINGS_NAMESPACE)

/** Read the registered preference or use the schema default without a settings provider. */
function readPreference(ctx: Context): ThemePreference {
  const settings = ctx.get('settings')
  if (settings === undefined) return DEFAULT_PREFERENCE
  const section = settings.get(THEME_NAMESPACE) as ThemeSettings | undefined
  if (section === undefined) return DEFAULT_PREFERENCE
  return section.preference
}

/**
 * Register the durable theme section and initial-theme index transform when
 * their optional Host services are composed.
 * @param ctx - Host context that may acquire settings and HTTP services.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(THEME_NAMESPACE, ThemeSettingsSchema)
  })
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(
      () => httpCtx.webServer.tapIndex(html => injectBootTheme(html, readPreference(ctx))),
      'client-ui-theme: initial theme bootstrap',
    )
  })
}
