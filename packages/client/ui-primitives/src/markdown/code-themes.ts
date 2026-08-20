import githubLightDefault from '@shikijs/themes/github-light-default'
import githubDarkDefault from '@shikijs/themes/github-dark-default'
import oneLight from '@shikijs/themes/one-light'
import oneDarkPro from '@shikijs/themes/one-dark-pro'
import catppuccinLatte from '@shikijs/themes/catppuccin-latte'
import catppuccinMocha from '@shikijs/themes/catppuccin-mocha'
import rosePineDawn from '@shikijs/themes/rose-pine-dawn'
import rosePineMoon from '@shikijs/themes/rose-pine-moon'
import vitesseLight from '@shikijs/themes/vitesse-light'
import vitesseDark from '@shikijs/themes/vitesse-dark'
import kanagawaLotus from '@shikijs/themes/kanagawa-lotus'
import kanagawaWave from '@shikijs/themes/kanagawa-wave'
import everforestLight from '@shikijs/themes/everforest-light'
import everforestDark from '@shikijs/themes/everforest-dark'
import tokyoNight from '@shikijs/themes/tokyo-night'
import tokyoNightLight from './themes/tokyo-night-light.ts'
import type { ThemeRegistration } from 'shiki/core'

/** Stable product ids persisted by ui-theme and stamped on code-surface ancestors. */
export const CODE_THEME_IDS = [
  'deepcreator-light', 'deepcreator-dark',
  'github-light', 'github-dark',
  'one-light', 'one-dark',
  'catppuccin-light', 'catppuccin-dark',
  'rose-pine-light', 'rose-pine-dark',
  'vitesse-light', 'vitesse-dark',
  'kanagawa-light', 'kanagawa-dark',
  'everforest-light', 'everforest-dark',
  'tokyo-night-light', 'tokyo-night-dark',
] as const

export type CodeThemeId = typeof CODE_THEME_IDS[number]
export type LightCodeThemeId = Extract<CodeThemeId, `${string}-light`>
export type DarkCodeThemeId = Exclude<CodeThemeId, LightCodeThemeId>

const deepcreatorLight = {
  name: 'deepcreator-light',
  type: 'light',
  colors: { 'editor.foreground': '#0f1115', 'editor.background': '#fff' },
  settings: [
    { settings: { foreground: '#0f1115', background: '#fff' } },
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

const githubLight = { ...githubLightDefault, name: 'github-light' } as ThemeRegistration
const githubDark = { ...githubDarkDefault, name: 'github-dark' } as ThemeRegistration

/**
 * Third-party open-source themes ship under their upstream variant and are
 * re-keyed to the product id convention (`-light`/`-dark` suffix drives the
 * ui-theme light/dark split). Shiki only distributes Tokyo Night's dark
 * variant, so its official Light TextMate source is registered locally.
 */
const catppuccinLight = { ...catppuccinLatte, name: 'catppuccin-light' } as ThemeRegistration
const catppuccinDark = { ...catppuccinMocha, name: 'catppuccin-dark' } as ThemeRegistration
const rosePineLight = { ...rosePineDawn, name: 'rose-pine-light' } as ThemeRegistration
const rosePineDark = { ...rosePineMoon, name: 'rose-pine-dark' } as ThemeRegistration
const vitesseLightTheme = { ...vitesseLight, name: 'vitesse-light' } as ThemeRegistration
const vitesseDarkTheme = { ...vitesseDark, name: 'vitesse-dark' } as ThemeRegistration
const kanagawaLight = { ...kanagawaLotus, name: 'kanagawa-light' } as ThemeRegistration
const kanagawaDark = { ...kanagawaWave, name: 'kanagawa-dark' } as ThemeRegistration
const everforestLightTheme = { ...everforestLight, name: 'everforest-light' } as ThemeRegistration
const everforestDarkTheme = { ...everforestDark, name: 'everforest-dark' } as ThemeRegistration
const tokyoNightLightTheme = { ...tokyoNightLight, name: 'tokyo-night-light' } as ThemeRegistration
const tokyoNightDark = { ...tokyoNight, name: 'tokyo-night-dark' } as ThemeRegistration

/** All themes are tokenized together; CSS chooses one without re-running Shiki. */
export const CODE_THEME_REGISTRATIONS: readonly ThemeRegistration[] = [
  deepcreatorLight,
  deepcreatorDark,
  githubLight,
  githubDark,
  oneLight,
  { ...oneDarkPro, name: 'one-dark' },
  catppuccinLight,
  catppuccinDark,
  rosePineLight,
  rosePineDark,
  vitesseLightTheme,
  vitesseDarkTheme,
  kanagawaLight,
  kanagawaDark,
  everforestLightTheme,
  everforestDarkTheme,
  tokyoNightLightTheme,
  tokyoNightDark,
]

/** Multi-theme map consumed by Shiki. Product ids are also the generated CSS-variable suffixes. */
export const CODE_THEME_MAP: Record<CodeThemeId, ThemeRegistration> = {
  'deepcreator-light': deepcreatorLight,
  'deepcreator-dark': deepcreatorDark,
  'github-light': githubLight,
  'github-dark': githubDark,
  'one-light': oneLight,
  'one-dark': { ...oneDarkPro, name: 'one-dark' },
  'catppuccin-light': catppuccinLight,
  'catppuccin-dark': catppuccinDark,
  'rose-pine-light': rosePineLight,
  'rose-pine-dark': rosePineDark,
  'vitesse-light': vitesseLightTheme,
  'vitesse-dark': vitesseDarkTheme,
  'kanagawa-light': kanagawaLight,
  'kanagawa-dark': kanagawaDark,
  'everforest-light': everforestLightTheme,
  'everforest-dark': everforestDarkTheme,
  'tokyo-night-light': tokyoNightLightTheme,
  'tokyo-night-dark': tokyoNightDark,
}
