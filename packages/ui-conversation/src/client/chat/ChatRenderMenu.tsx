// ChatRenderMenu: the render-mode picker at the right end of the session
// header. A layered-view trigger describes the alternate presentation modes
// and lists every registered
// mode from the 'conversation.chat.render' ledger, with the active mode
// marked. The switch write goes through the owner's store action, so the
// choice persists with the session.

import { useState } from 'react'
import clsx from 'clsx'
import { Menu, Tooltip, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** Three aligned lines identify alternate renderings of the same session. */
function RenderModeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  )
}

/** The header's render-mode picker: layered-view trigger plus mode menu. */
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
          <Tooltip label={t('chat.render.hint')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.trigger}
              aria-label={t('chat.render.aria')}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => { setOpen(v => !v) }}
            >
              <RenderModeIcon />
            </button>
          </Tooltip>
        )}
      />
    </div>
  )
}
