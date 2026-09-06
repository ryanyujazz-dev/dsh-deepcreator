/**
 * Appearance and font-size row slot stores: mirrors of the theme service
 * snapshot. The plugin's apply-world change listener is the only writer; the
 * row components read via props.useStore.
 */
import {
  defineStore,
  type EngineStoreHandle,
} from '@deepseek-ai/dsh-client-store'
import {
  DEFAULT_FONT_SIZE,
  type CodeFont, type DarkCodeTheme, type LightCodeTheme, type ThemePreference, type TranscriptTextSize,
} from '../theme-settings.ts'

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Persisted preference (selection state reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Persisted transcript typography size. */
  transcriptTextSize: TranscriptTextSize
  lightCodeTheme: LightCodeTheme
  darkCodeTheme: DarkCodeTheme
  codeFont: CodeFont
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (
    draft: AppearanceRowState,
    preference: ThemePreference,
    transcriptTextSize: TranscriptTextSize,
    lightCodeTheme: LightCodeTheme,
    darkCodeTheme: DarkCodeTheme,
    codeFont: CodeFont,
    revision: number,
  ) => void
}

/**
 * Declares the Appearance row state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({
      preference: 'system', transcriptTextSize: 'standard',
      lightCodeTheme: 'deepcreator-light', darkCodeTheme: 'deepcreator-dark', codeFont: 'system', revision: -1,
    }),
    actions: {
      sync: (
        d,
        preference: ThemePreference,
        transcriptTextSize: TranscriptTextSize,
        lightCodeTheme: LightCodeTheme,
        darkCodeTheme: DarkCodeTheme,
        codeFont: CodeFont,
        revision: number,
      ) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.transcriptTextSize = transcriptTextSize
        d.lightCodeTheme = lightCodeTheme
        d.darkCodeTheme = darkCodeTheme
        d.codeFont = codeFont
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's font size (official rc.1). */
export interface FontSizeRowState {
  /** Persisted content font size in px. */
  fontSize: number
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontSizeRowActions = {
  sync: (draft: FontSizeRowState, fontSize: number, revision: number) => void
}

/**
 * Declares the font-size row state and write surface (official rc.1).
 * @returns the store handle.
 */
export function createFontSizeRowStore(): EngineStoreHandle<FontSizeRowState, FontSizeRowActions> {
  return defineStore({
    init: (): FontSizeRowState => ({ fontSize: DEFAULT_FONT_SIZE, revision: -1 }),
    actions: {
      sync: (d, fontSize: number, revision: number) => {
        if (revision <= d.revision) return
        d.fontSize = fontSize
        d.revision = revision
      },
    },
  })
}
