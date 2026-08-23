import { useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserClientRuntime, BrowserRemoteClient } from './runtime.ts'
import css from './BrowserDataSetting.module.css'

type Props = PropsRuntime<'deepcreator.settings.preferences.item'> & PropsLocale<'browser'> & { remote: BrowserRemoteClient; browser: BrowserClientRuntime }

export function BrowserDataSetting({ remote, browser, t }: Props) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const [managing, setManaging] = useState<string>()
  const [diagnostic, setDiagnostic] = useState<string>()
  const snapshot = useSyncExternalStore(browser.subscribe, browser.getSnapshot, browser.getSnapshot)
  const clear = async () => {
    if (remote.clearBrowserData === undefined || !window.confirm(t('clearConfirm'))) return
    setState('working')
    try {
      const result = await remote.clearBrowserData('all')
      setState(result.ok && result.value.ok ? 'done' : 'error')
    } catch { setState('error') }
  }
  const manage = async (browserId: string) => {
    if (remote.manageProvider === undefined || !window.confirm(t('installConfirm'))) return
    setManaging(browserId); setDiagnostic(undefined)
    try {
      const result = await remote.manageProvider(browserId, 'install')
      if (!result.ok) setDiagnostic(`${result.error.code}: ${result.error.message}`)
      else if (!result.value.ok) setDiagnostic(`${result.value.code}: ${result.value.message}`)
      else setDiagnostic(result.value.value.diagnostic ?? (result.value.value.status === 'ready' ? t('providerReady') : t('providerUnavailable')))
      await browser.refresh()
    } catch (error) { setDiagnostic(error instanceof Error ? error.message : String(error)) }
    finally { setManaging(undefined) }
  }
  const manageable = snapshot.state.browsers.filter(provider => provider.capabilities.includes('management.install'))
  return <div className={css.section}>
    <div className={css.row}>
      <div className={css.copy}><div className={css.title}>{t('clearData')}</div><div className={css.description}>{t('clearDescription')}</div></div>
      <button type="button" className={css.button} disabled={state === 'working' || remote.clearBrowserData === undefined} onClick={() => { void clear() }}>{state === 'working' ? t('clearing') : t('clearAction')}</button>
      {state === 'done' ? <span className={css.status}>{t('cleared')}</span> : state === 'error' ? <span className={css.error}>{t('clearFailed')}</span> : null}
    </div>
    <div className={css.providers}>
      <div><div className={css.title}>{t('providerStatus')}</div><div className={css.description}>{t('providerStatusDescription')}</div></div>
      {manageable.map(provider => <div className={css.provider} key={provider.browserId}>
        <div className={css.copy}><div className={css.providerName}>{provider.name}</div><div className={provider.availability === 'available' ? css.status : css.error}>{provider.availability === 'available' ? t('providerReady') : provider.diagnostic ?? t('providerUnavailable')}</div></div>
        {provider.availability === 'unavailable' ? <button type="button" className={css.button} disabled={managing !== undefined || remote.manageProvider === undefined} onClick={() => { void manage(provider.browserId) }}>{managing === provider.browserId ? t('installing') : t('installAction')}</button> : null}
      </div>)}
      {diagnostic === undefined ? null : <div className={css.diagnostic}>{diagnostic}</div>}
    </div>
  </div>
}
