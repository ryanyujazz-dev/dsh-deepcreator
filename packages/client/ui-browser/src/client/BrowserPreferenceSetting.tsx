import { useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserSettings } from '@ryanyujazz/dsh-browser'
import css from './BrowserPreferenceSetting.module.css'

type Props = PropsRuntime<'deepcreator.settings.preferences.item'> & PropsLocale<'browser'> & { settings: SettingsScope<BrowserSettings> }
const DEFAULTS: BrowserSettings = { defaultAutomation: 'playwright', playwrightDefaultEngine: 'chromium', visibleProviderOrder: ['iab', 'chrome', 'playwright-chromium'] }
const ORDERS = {
  iab: ['iab', 'chrome', 'playwright-chromium'],
  chrome: ['chrome', 'iab', 'playwright-chromium'],
  playwright: ['playwright-chromium', 'iab', 'chrome'],
} as const

export function BrowserPreferenceSetting({ settings, t }: Props) {
  const snapshot = useSyncExternalStore(listener => settings.subscribe(listener), () => settings.getSnapshot())
  const value = snapshot.value ?? DEFAULTS
  const visible = value.visibleProviderOrder[0] === 'chrome' ? 'chrome' : value.visibleProviderOrder[0]?.startsWith('playwright-') ? 'playwright' : 'iab'
  return <div className={css.group}>
    <label className={css.row}><span><span className={css.title}>{t('automationDefault')}</span><span className={css.description}>{t('automationDescription')}</span></span><select value={value.defaultAutomation} onChange={event => { void settings.set('defaultAutomation', event.target.value as BrowserSettings['defaultAutomation']) }}><option value="playwright">Playwright</option><option value="semantic">Semantic</option></select></label>
    <label className={css.row}><span><span className={css.title}>{t('engineDefault')}</span><span className={css.description}>{t('engineDescription')}</span></span><select value={value.playwrightDefaultEngine} onChange={event => { void settings.set('playwrightDefaultEngine', event.target.value as BrowserSettings['playwrightDefaultEngine']) }}><option value="chromium">Chromium</option><option value="firefox">Firefox</option><option value="webkit">WebKit</option></select></label>
    <label className={css.row}><span><span className={css.title}>{t('visibleDefault')}</span><span className={css.description}>{t('visibleDescription')}</span></span><select value={visible} onChange={event => { void settings.set('visibleProviderOrder', [...ORDERS[event.target.value as keyof typeof ORDERS]]) }}><option value="iab">{t('visibleIab')}</option><option value="chrome">{t('visibleChrome')}</option><option value="playwright">{t('visiblePlaywright')}</option></select></label>
  </div>
}
