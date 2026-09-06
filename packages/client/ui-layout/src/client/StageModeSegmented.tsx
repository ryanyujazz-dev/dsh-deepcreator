/**
 * The stage-mode segmented control (对话｜应用): the one first-class switch
 * between the conversation Stage and the App Stage takeover. It is a
 * ui-layout contribution because the mode IS layout state (the same store
 * drives the covering geometry in AppFrame); it renders inside ui-sidebar's
 * `sidebar.stage-mode` seat, between the Brand row and the primary action
 * list, and disappears with the sidebar's wide content (the collapsed rail
 * keeps no mode affordance; the mode itself survives). Pure component: state
 * arrives through the shared layout store seat, writes through its baked
 * actions.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-sidebar's SlotMap merge (the 'sidebar.stage-mode' entry
// this registration targets) into programs that see this component.
import type {} from '@ryanyujazz/dsh-client-ui-sidebar/client'
import type { createLayoutStore } from './stores.ts'
import css from './StageModeSegmented.module.css'

/** Full composed props: seat owner share + shared layout store + locale. */
export type StageModeSegmentedProps =
  & PropsRuntime<'sidebar.stage-mode'>
  & PropsStore<ReturnType<typeof createLayoutStore>>
  & PropsLocale<'layout'>

/**
 * Render the 对话｜应用 segmented switch.
 * @param props - composed slot props (sidebar column state + layout store + locale).
 * @returns the segmented control, or nothing while the sidebar is collapsed.
 */
export function StageModeSegmented({ wide, useStore, actions, t }: StageModeSegmentedProps) {
  const stageMode = useStore(s => s.stageMode)
  const activity = useStore(s => s.stageActivity)
  if (!wide) return null
  return (
    <div className={css.stageModeSwitcher} role="tablist" aria-label={t('stage-mode.switcher')}>
      <button
        type="button"
        role="tab"
        aria-selected={stageMode === 'conversation'}
        className={css.segment}
        onClick={() => { actions.setStageMode('conversation') }}
      >
        {t('stage-mode.conversation')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={stageMode === 'apps'}
        className={css.segment}
        onClick={() => { actions.setStageMode('apps') }}
      >
        {t('stage-mode.apps')}
        {activity !== undefined && (
          <span className={css.segmentDot} aria-hidden="true" title={t('stage-mode.activity').replace('{name}', activity.name)} />
        )}
      </button>
    </div>
  )
}
