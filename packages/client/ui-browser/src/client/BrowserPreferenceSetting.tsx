import { useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserSettings } from '@ryanyujazz/dsh-browser'
import { IconChevronDownOutline14, Menu } from '@ryanyujazz/dsh-client-ui-primitives'
import css from './BrowserPreferenceSetting.module.css'

type Props = PropsLocale<'browser'> & { settings: SettingsScope<BrowserSettings> }
const DEFAULTS: BrowserSettings = { defaultAutomation: 'playwright', playwrightDefaultEngine: 'chromium', visibleProviderOrder: ['iab', 'chrome', 'playwright-chromium'] }
const ORDERS = {
  iab: ['iab', 'chrome', 'playwright-chromium'],
  chrome: ['chrome', 'iab', 'playwright-chromium'],
  playwright: ['playwright-chromium', 'iab', 'chrome'],
} as const

function PreferenceSelect({ label, value, options, onSelect }: {
  label: string
  value: string
  options: readonly { id: string; label: string }[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.id === value)?.label ?? value
  return <Menu
    open={open}
    onClose={() => { setOpen(false) }}
    items={options}
    selectedId={value}
    onSelect={(id) => { onSelect(id); setOpen(false) }}
    align="end"
    portal
    anchor={<button type="button" className={css.selector} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => { setOpen(current => !current) }}><span>{selected}</span><IconChevronDownOutline14 className={css.chevron} /></button>}
  />
}

export function BrowserPreferenceSetting({ settings, t }: Props) {
  const snapshot = useSyncExternalStore(listener => settings.subscribe(listener), () => settings.getSnapshot())
  const value = snapshot.value ?? DEFAULTS
  const visible = value.visibleProviderOrder[0] === 'chrome' ? 'chrome' : value.visibleProviderOrder[0]?.startsWith('playwright-') ? 'playwright' : 'iab'
  return <div className={css.group}>
    <div className={css.row}><span className={css.copy}><span className={css.title}>{t('automationDefault')}</span><span className={css.description}>{t('automationDescription')}</span></span><PreferenceSelect label={t('automationDefault')} value={value.defaultAutomation} options={[{ id: 'playwright', label: 'Playwright' }, { id: 'semantic', label: 'Semantic' }]} onSelect={(id) => { void settings.set('defaultAutomation', id as BrowserSettings['defaultAutomation']) }} /></div>
    <div className={css.row}><span className={css.copy}><span className={css.title}>{t('engineDefault')}</span><span className={css.description}>{t('engineDescription')}</span></span><PreferenceSelect label={t('engineDefault')} value={value.playwrightDefaultEngine} options={[{ id: 'chromium', label: 'Chromium' }, { id: 'firefox', label: 'Firefox' }, { id: 'webkit', label: 'WebKit' }]} onSelect={(id) => { void settings.set('playwrightDefaultEngine', id as BrowserSettings['playwrightDefaultEngine']) }} /></div>
    <div className={css.row}><span className={css.copy}><span className={css.title}>{t('visibleDefault')}</span><span className={css.description}>{t('visibleDescription')}</span></span><PreferenceSelect label={t('visibleDefault')} value={visible} options={[{ id: 'iab', label: t('visibleIab') }, { id: 'chrome', label: t('visibleChrome') }, { id: 'playwright', label: t('visiblePlaywright') }]} onSelect={(id) => { void settings.set('visibleProviderOrder', [...ORDERS[id as keyof typeof ORDERS]]) }} /></div>
  </div>
}
