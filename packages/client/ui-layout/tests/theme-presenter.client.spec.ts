// @vitest-environment jsdom
// ThemePresenter behavior account: root color-scheme and the palette attribute
// follow active.colorScheme only, token variables replace the previous apply's
// set, theme-color metadata follows the rendered body background, and dispose
// retracts everything the presenter wrote. On the Windows Electron shell the
// presenter additionally pushes the resolved palette probe colors to the
// native title bar bridge on every apply.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeSnapshot } from '@ryanyujazz/dsh-client-ui-theme/client'
import { CODE_THEME_ATTRIBUTE, DARK_ATTRIBUTE, ThemePresenter } from '@ryanyujazz/dsh-client-ui-layout/src/client/theme-presenter.ts'

const LIGHT_THEME_COLOR = 'rgb(255, 255, 255)'
const DARK_THEME_COLOR = 'rgb(21, 21, 23)'

function snapshot(colorScheme: 'light' | 'dark', tokens: Record<string, string> = {}): ThemeSnapshot {
  // The presenter must key off colorScheme, not the id — keep them distinct.
  const active = { id: `${colorScheme}-test`, colorScheme, tokens }
  return {
    preference: colorScheme,
    transcriptTextSize: 'standard',
    codeAppearance: {
      activeThemeId: colorScheme === 'dark' ? 'deepcreator-dark' : 'deepcreator-light',
      lightThemeId: 'deepcreator-light', darkThemeId: 'deepcreator-dark', fontId: 'system', revision: 1,
    },
    active, themes: [active], revision: 1,
  }
}

function clearThemePresentation(): void {
  document.head.querySelectorAll('meta[name="theme-color"], style[data-theme-presenter-test]').forEach((node) => { node.remove() })
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
}

beforeEach(() => {
  clearThemePresentation()
  document.documentElement.style.removeProperty('color-scheme')
  document.body.removeAttribute(DARK_ATTRIBUTE)
  document.body.removeAttribute(CODE_THEME_ATTRIBUTE)
  document.body.removeAttribute('style')
  const style = document.createElement('style')
  style.dataset.themePresenterTest = ''
  style.textContent = `
    body { background-color: ${LIGHT_THEME_COLOR}; }
    body[${DARK_ATTRIBUTE}] { background-color: ${DARK_THEME_COLOR}; }
  `
  document.head.append(style)
})

afterEach(clearThemePresentation)

describe('ThemePresenter', () => {
  it('light scheme sets root color-scheme and leaves the dark attribute absent', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.getAttribute(CODE_THEME_ATTRIBUTE)).toBe('deepcreator-light')
    expect(themeColorMeta()?.content).toBe(LIGHT_THEME_COLOR)
  })

  it('dark scheme sets root color-scheme, the attribute, and metadata; switching to light updates one node', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark'))
    const meta = themeColorMeta()
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(true)
    expect(document.body.getAttribute(CODE_THEME_ATTRIBUTE)).toBe('deepcreator-dark')
    expect(meta?.content).toBe(DARK_THEME_COLOR)
    presenter.apply(snapshot('light'))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.getAttribute(CODE_THEME_ATTRIBUTE)).toBe('deepcreator-light')
    expect(themeColorMeta()).toBe(meta)
    expect(meta?.content).toBe(LIGHT_THEME_COLOR)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
  })

  it('applies tokens as inline variables and clears the previous set on theme change', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111', '--dsw-alias-fg': '#eee' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#111')
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('#eee')
    presenter.apply(snapshot('light', { '--dsw-alias-bg': '#fff' }))
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('#fff')
    // The old theme's extra variable is gone, not merged.
    expect(document.body.style.getPropertyValue('--dsw-alias-fg')).toBe('')
  })

  it('dispose removes color-scheme, the attribute, and every applied variable, sparing foreign inline styles', () => {
    document.body.style.setProperty('--foreign', 'kept')
    const presenter = new ThemePresenter()
    presenter.apply(snapshot('dark', { '--dsw-alias-bg': '#111' }))
    const meta = themeColorMeta()
    presenter.dispose()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(document.body.hasAttribute(DARK_ATTRIBUTE)).toBe(false)
    expect(document.body.hasAttribute(CODE_THEME_ATTRIBUTE)).toBe(false)
    expect(document.body.style.getPropertyValue('--dsw-alias-bg')).toBe('')
    expect(document.body.style.getPropertyValue('--foreign')).toBe('kept')
    expect(meta?.isConnected).toBe(false)
  })
})

describe('ThemePresenter - Windows title bar overlay push', () => {
  const WINDOWS_ELECTRON_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Electron/43.4.0 Safari/537.36'
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36'
  const PROBE_BG = 'rgb(25, 25, 27)'
  const PROBE_LABEL = 'rgb(240, 240, 242)'

  /**
   * jsdom does not resolve var() through getComputedStyle, so the probe's
   * computation is stubbed for the palette probe element only; the
   * presenter's contract under test is "push the probe's computed colors".
   */
  function stubProbeComputation(): void {
    const real = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, ...rest) => {
      const style = real(element, ...rest)
      if (element instanceof HTMLDivElement && element.style.cssText.includes('--dsw-alias-bg-base')) {
        return { ...style, backgroundColor: PROBE_BG, color: PROBE_LABEL } as CSSStyleDeclaration
      }
      return style
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'deepcreatorWindow')
    clearThemePresentation()
  })

  it('pushes the resolved probe colors on every apply in the Windows Electron shell', () => {
    stubProbeComputation()
    const setTitleBarTheme = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'deepcreatorWindow', {
      value: { setTitleBarTheme }, configurable: true,
    })
    const presenter = new ThemePresenter(WINDOWS_ELECTRON_UA)
    presenter.apply(snapshot('dark'))
    presenter.apply(snapshot('light'))
    expect(setTitleBarTheme).toHaveBeenCalledTimes(2)
    expect(setTitleBarTheme).toHaveBeenLastCalledWith(PROBE_BG, PROBE_LABEL)
    presenter.dispose()
  })

  it('skips the push when the probe has no concrete colors yet', () => {
    // No stub: jsdom returns the unresolved var() strings, which must be
    // dropped instead of forwarded to the native overlay painter.
    const setTitleBarTheme = vi.fn()
    Object.defineProperty(window, 'deepcreatorWindow', {
      value: { setTitleBarTheme }, configurable: true,
    })
    const presenter = new ThemePresenter(WINDOWS_ELECTRON_UA)
    presenter.apply(snapshot('dark'))
    expect(setTitleBarTheme).not.toHaveBeenCalled()
  })

  it('never touches the bridge outside the Windows Electron shell', () => {
    stubProbeComputation()
    const setTitleBarTheme = vi.fn()
    Object.defineProperty(window, 'deepcreatorWindow', {
      value: { setTitleBarTheme }, configurable: true,
    })
    const presenter = new ThemePresenter(BROWSER_UA)
    presenter.apply(snapshot('dark'))
    expect(setTitleBarTheme).not.toHaveBeenCalled()
  })
})
