import githubLight from '@shikijs/themes/github-light'
import githubDark from '@shikijs/themes/github-dark'
import oneLight from '@shikijs/themes/one-light'
import oneDarkPro from '@shikijs/themes/one-dark-pro'
import type { ThemeRegistration } from 'shiki/core'

/** Stable product ids persisted by ui-theme and stamped on code-surface ancestors. */
export const CODE_THEME_IDS = [
  'deepcreator-light', 'deepcreator-dark',
  'github-light', 'github-dark',
  'one-light', 'one-dark',
] as const

export type CodeThemeId = typeof CODE_THEME_IDS[number]
export type LightCodeThemeId = Extract<CodeThemeId, `${string}-light`>
export type DarkCodeThemeId = Exclude<CodeThemeId, LightCodeThemeId>

const deepcreatorLight = {
  name: 'deepcreator-light',
  type: 'light',
  colors: { 'editor.foreground': '#0f1115', 'editor.background': '#f9fafb' },
  settings: [
    { settings: { foreground: '#0f1115', background: '#f9fafb' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#68707d', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type'], settings: { foreground: '#c2255c' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#237b3d' } },
    { scope: ['constant', 'constant.numeric', 'constant.language'], settings: { foreground: '#1769aa' } },
    { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#5f3dc4' } },
    { scope: ['variable.parameter'], settings: { foreground: '#c65102' } },
    { scope: ['entity.name.type', 'support.type'], settings: { foreground: '#087f5b' } },
  ],
} as ThemeRegistration

const deepcreatorDark = {
  name: 'deepcreator-dark',
  type: 'dark',
  colors: { 'editor.foreground': '#f1f3f5', 'editor.background': '#1b1b1c' },
  settings: [
    { settings: { foreground: '#f1f3f5', background: '#1b1b1c' } },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: '#a7afb9', fontStyle: 'italic' } },
    { scope: ['keyword', 'storage', 'storage.type'], settings: { foreground: '#faa2c1' } },
    { scope: ['string', 'string.quoted', 'string.template'], settings: { foreground: '#8ce99a' } },
    { scope: ['constant', 'constant.numeric', 'constant.language'], settings: { foreground: '#74c0fc' } },
    { scope: ['entity.name.function', 'support.function'], settings: { foreground: '#b197fc' } },
    { scope: ['variable.parameter'], settings: { foreground: '#ffa94d' } },
    { scope: ['entity.name.type', 'support.type'], settings: { foreground: '#63e6be' } },
  ],
} as ThemeRegistration

/** All themes are tokenized together; CSS chooses one without re-running Shiki. */
export const CODE_THEME_REGISTRATIONS: readonly ThemeRegistration[] = [
  deepcreatorLight,
  deepcreatorDark,
  githubLight,
  githubDark,
  oneLight,
  { ...oneDarkPro, name: 'one-dark' },
]

/** Multi-theme map consumed by Shiki. Product ids are also the generated CSS-variable suffixes. */
export const CODE_THEME_MAP: Record<CodeThemeId, ThemeRegistration> = {
  'deepcreator-light': deepcreatorLight,
  'deepcreator-dark': deepcreatorDark,
  'github-light': githubLight,
  'github-dark': githubDark,
  'one-light': oneLight,
  'one-dark': { ...oneDarkPro, name: 'one-dark' },
}
