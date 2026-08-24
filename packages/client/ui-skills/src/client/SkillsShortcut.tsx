import { DeepCreatorIconSkillOutline16, SIDEBAR_ICON_SIZE, SidebarRow, Tooltip } from '@ryanyujazz/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillsShortcut.module.css'

export interface SkillsShortcutInjected { open: () => void }

export type SkillsShortcutProps =
  PropsRuntime<'sidebar.primary.action'>
  & PropsLocale<'skills'>
  & InjectFace<SkillsShortcutInjected>

export function SkillsShortcut({ wide, open, t }: SkillsShortcutProps) {
  return (
    <li className={css.item}>
      <Tooltip label={t('shortcutLabel')} delayMs={500} disabled={wide}>
        <SidebarRow
          as="button"
          type="button"
          className={css.row}
          aria-label={t('shortcutLabel')}
          onClick={open}
        >
          <DeepCreatorIconSkillOutline16 size={SIDEBAR_ICON_SIZE} />
          {wide ? <span className={css.label}>{t('shortcut')}</span> : null}
        </SidebarRow>
      </Tooltip>
    </li>
  )
}
