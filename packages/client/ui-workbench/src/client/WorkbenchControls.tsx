import { useState, useSyncExternalStore } from 'react'
import {
  DeepCreatorIconPanels16, ICON_TOOLBAR_GLYPH_SIZE, Menu, Tooltip, type MenuEntry,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchControlsProps } from './contract.ts'
import css from './WorkbenchControls.module.css'

export function WorkbenchControls({
  renderSlot, controller, addressed, panelControls, t,
}: WorkbenchControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  useSyncExternalStore(controller.types.subscribe, controller.types.version)
  useSyncExternalStore(controller.visibility.subscribe, controller.visibility.version)
  const definitions = controller.types.list()
  // The strip order is a declared product priority (`order`), not plugin
  // activation order; the stable sort keeps unordered types in registration
  // order after all ordered ones.
  const ordered = [...definitions].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
  const visibleTypeIds = controller.visibility.list()

  if (definitions.length === 0) return null

  if (panelControls === 'compact') {
    const items: MenuEntry[] = ordered.map(definition => ({
      id: definition.id,
      label: definition.label(),
      icon: renderSlot('deepcreator.workbench.panel-icon', { size: 16, visible: visibleTypeIds.includes(definition.id) }, { only: definition.id }),
      disabled: addressed && definition.disabledWhenAddressed === true,
    }))
    return (
      <div className={css.controls} aria-label={t('panels')}>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={items}
          selectedIds={visibleTypeIds}
          onSelect={(typeId) => {
            if (visibleTypeIds.includes(typeId)) controller.hide(typeId)
            else controller.activate(typeId)
            setMenuOpen(false)
          }}
          portal
          align="end"
          anchor={(
            <Tooltip label={t('panels')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.button}
              aria-label={t('panels')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-pressed={visibleTypeIds.length > 0}
              onClick={() => { setMenuOpen(value => !value) }}
            >
              <DeepCreatorIconPanels16 size={ICON_TOOLBAR_GLYPH_SIZE} />
            </button>
            </Tooltip>
          )}
        />
      </div>
    )
  }

  return (
    <div className={css.controls} aria-label={t('panels')}>
      {ordered.map((definition) => {
        const visible = visibleTypeIds.includes(definition.id)
        const label = definition.label()
        const disabled = addressed && definition.disabledWhenAddressed === true
        return (
          <Tooltip key={definition.id} label={t(visible ? 'hide' : 'open', { type: label })} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.button}
              aria-label={t(visible ? 'hide' : 'open', { type: label })}
              aria-pressed={visible}
              disabled={disabled}
              onClick={() => {
                if (visible) controller.hide(definition.id)
                else controller.activate(definition.id)
              }}
            >
              {renderSlot('deepcreator.workbench.panel-icon', { size: ICON_TOOLBAR_GLYPH_SIZE, visible }, { only: definition.id })}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
