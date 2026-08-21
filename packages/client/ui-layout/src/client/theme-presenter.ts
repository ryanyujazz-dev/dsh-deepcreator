/**
 * Global theme DOM applier: projects the resolved ThemeSnapshot onto the
 * document — `html { color-scheme }` for native UA chrome (scrollbars, form
 * controls), `body[data-ds-dark-theme]` for the token palette, the active
 * theme's alias-token overrides as inline CSS variables on body, and one
 * presenter-owned `meta[name="theme-color"]` for surrounding browser UI. On
 * the Windows Electron shell it also recolors the native Window Controls
 * Overlay through the desktop bridge. Pure DOM writes, no React involvement;
 * the presenter only ever retracts what it wrote itself, so foreign
 * attributes, metadata, and inline styles survive.
 */
import type { ThemeSnapshot } from '@ryanyujazz/dsh-client-ui-theme/client'
import { detectNativeWindowChrome } from './native-window-chrome.ts'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'
/** Body attribute selecting the active syntax and diff palette. */
export const CODE_THEME_ATTRIBUTE = 'data-code-theme'

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names this presenter wrote in the last apply (its retraction set). */
  private appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  private readonly themeColorMeta: HTMLMetaElement
  /**
   * Off-screen probe resolving the base-background and primary-label tokens
   * to computed colors for the Windows title bar overlay. Custom-property
   * lookup alone stops at unresolved var() chains, so a rendered element is
   * the only faithful source.
   */
  private readonly paletteProbe: HTMLDivElement
  /** Cached Windows Electron shell detection (the overlay push is win32-only). */
  private readonly isWindowsElectron: boolean

  /** Create the presenter-owned metadata node before the first snapshot arrives. */
  constructor(userAgent: string = navigator.userAgent) {
    this.themeColorMeta = document.createElement('meta')
    this.themeColorMeta.name = 'theme-color'
    this.isWindowsElectron = detectNativeWindowChrome(userAgent) === 'windows'
    this.paletteProbe = document.createElement('div')
    this.paletteProbe.style.cssText
      = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none;'
        + 'background-color:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);'
  }

  /**
   * Project a snapshot onto the document: set root `color-scheme` and the body
   * palette attribute from `active.colorScheme` (never the id — `system` is
   * resolved upstream), then replace the previously applied token variables
   * with `active.tokens`. Browser theme-color metadata follows the computed
   * body background after those writes, so the rendered palette remains the
   * color authority. On the Windows Electron shell the resolved base
   * background and primary label colors are also pushed to the native
   * Window Controls Overlay so the caption buttons follow the theme.
   * @param snapshot - resolved theme snapshot from ctx.theme.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)
    body.setAttribute(CODE_THEME_ATTRIBUTE, snapshot.codeAppearance.activeThemeId)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.appliedTokens.push(name)
    }
    this.themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta)
    if (this.isWindowsElectron) this.pushTitleBarTheme()
  }

  /** Retract root color-scheme, the palette attribute, token variables, and the owned metadata node. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    body.removeAttribute(CODE_THEME_ATTRIBUTE)
    for (const name of this.appliedTokens) body.style.removeProperty(name)
    this.appliedTokens = []
    this.themeColorMeta.remove()
    this.paletteProbe.remove()
  }

  /**
   * Resolve the palette probe's computed colors and forward them to the
   * desktop bridge. A value that is not a concrete color yet (var() chains
   * unresolved, tokens absent) is skipped rather than forwarded as garbage.
   */
  private pushTitleBarTheme(): void {
    if (!this.paletteProbe.isConnected) document.body.append(this.paletteProbe)
    const style = getComputedStyle(this.paletteProbe)
    const color = style.backgroundColor
    const symbolColor = style.color
    if (!CSS_COLOR.test(color) || !CSS_COLOR.test(symbolColor)) return
    void window.deepcreatorWindow?.setTitleBarTheme(color, symbolColor)
  }
}

/** Concrete computed color shapes accepted for the overlay push. */
const CSS_COLOR = /^(?:rgb|hsl)a?\(|#/
