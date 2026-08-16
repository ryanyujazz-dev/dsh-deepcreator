// ChatRenderMenu: the render-mode picker at the right end of the session
// header's tab bar. A three-dot trigger (mirroring the sidebar session-more
// affordance) surfaces on tab-bar hover; the menu lists every registered
// mode from the 'conversation.chat.render' ledger, with the active mode
// marked. The switch write goes through the owner's store action, so the
// choice persists with the session.

import { useState } from 'react'
import clsx from 'clsx'
import { IconEllipsisOutline16, Menu, Tooltip, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ViewTab } from '../contract/views.ts'
import css from './ChatRenderMenu.module.css'

interface ChatRenderMenuProps {
  /** Registered render modes (label falls back to the entry id). */
  modes: readonly ViewTab[]
  /** The active mode id (the menu marks it). */
  activeId: string
  /** Switch the active mode (persisted by the owner store). */
  onPick: (id: string) => void
  /** The header's locale seat. */
  t: TranslateNS<'conversation'>
}

/** The header's render-mode picker: ellipsis trigger + mode menu. */
export function ChatRenderMenu({ modes, activeId, onPick, t }: ChatRenderMenuProps) {
  const [open, setOpen] = useState(false)
  const items: MenuEntry[] = modes.map(mode => ({ id: mode.id, label: mode.label }))
  return (
    <div className={clsx(css.seat, open && css.menuOpen)}>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={items}
        selectedId={activeId}
        onSelect={(id) => {
          onPick(id)
          setOpen(false)
        }}
        portal
        anchor={(
          <Tooltip label={t('chat.render.hint')} side="bottom">
            <button
              type="button"
              className={css.trigger}
              aria-label={t('chat.render.aria')}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => { setOpen(v => !v) }}
            >
              <IconEllipsisOutline16 />
            </button>
          </Tooltip>
        )}
      />
    </div>
  )
}
