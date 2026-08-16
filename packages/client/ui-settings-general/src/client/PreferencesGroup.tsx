/** DeepCreator Preferences block inside General settings. */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './PreferencesGroup.module.css'

/** Full Preferences-block props. */
export type PreferencesGroupProps =
  PropsRuntime<'settings.general.item'>
  & PropsRenderSlots<'deepcreator.settings.preferences.item'>
  & PropsLocale<'settings'>

/** Render the shared Preferences block and its feature-owned rows. */
export function PreferencesGroup({ renderSlot, t }: PreferencesGroupProps) {
  return (
    <section className={css.group} aria-label={t('general.preferences')}>
      <h2 className={css.title}>{t('general.preferences')}</h2>
      <div className={css.items}>
        {renderSlot('deepcreator.settings.preferences.item', {})}
      </div>
    </section>
  )
}
