import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserSettings } from '@ryanyujazz/dsh-browser'
import { BrowserDataSetting } from './BrowserDataSetting.tsx'
import { BrowserPreferenceSetting } from './BrowserPreferenceSetting.tsx'
import type { BrowserClientRuntime, BrowserRemoteClient } from './runtime.ts'
import css from './BrowserSettingsGroup.module.css'

type Props = PropsRuntime<'settings.general.item'> & PropsLocale<'browser'> & {
  remote: BrowserRemoteClient
  browser: BrowserClientRuntime
  settings: SettingsScope<BrowserSettings>
}

export function BrowserSettingsGroup({ remote, browser, settings, t }: Props) {
  return <section className={css.group} aria-label={t('browserSettings')}>
    <h2 className={css.title}>{t('browserSettings')}</h2>
    <div className={css.items}>
      <BrowserPreferenceSetting settings={settings} t={t} />
      <BrowserDataSetting remote={remote} browser={browser} t={t} />
    </div>
  </section>
}
