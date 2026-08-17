// ChatRenderMenu: the shared More control at the right edge of the Session
// Header. Render modes remain the first group and the official Session-log
// action lives in the second. Workbench owns its independent responsive Panel
// control; this component only tells that utility whether five buttons fit.

import { useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  ICON_TOOLBAR_BUTTON_SIZE, ICON_TOOLBAR_GAP, ICON_TOOLBAR_GLYPH_SIZE,
  IconDownloadOutline16, IconEllipsisOutline16, Menu, Tooltip, type MenuEntry,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSessionHeaderSlotProps } from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import css from './ChatRenderMenu.module.css'

interface ChatRenderMenuProps {
  /** Registered render modes (label falls back to the entry id). */
  modes: readonly ViewTab[]
  /** The active mode id (the menu marks it). */
  activeId: string
  /** Switch the active mode (persisted by the owner store). */
  onPick: (id: string) => void
  /** Render the known Header utility contributions in their requested placement. */
  renderUtilities: ConversationSessionHeaderSlotProps['renderSlot']
  /** The header's locale seat. */
  t: TranslateNS<'conversation'>
}

const MORE_BUTTON_WIDTH = ICON_TOOLBAR_BUTTON_SIZE
const HEADER_GROUP_GAP = ICON_TOOLBAR_GAP
const PANEL_BUTTON_WIDTH = ICON_TOOLBAR_BUTTON_SIZE
const PANEL_BUTTON_GAP = ICON_TOOLBAR_GAP
const MAX_PANEL_BUTTONS = 5
const EXPANDED_PANEL_CONTROLS_WIDTH = (
  MAX_PANEL_BUTTONS * PANEL_BUTTON_WIDTH
  + (MAX_PANEL_BUTTONS - 1) * PANEL_BUTTON_GAP
)

/** Five independent buttons are atomic: otherwise Workbench becomes one Panel menu. */
export function panelControlsMode(availableWidth: number): 'expanded' | 'compact' {
  const required = MORE_BUTTON_WIDTH + HEADER_GROUP_GAP + EXPANDED_PANEL_CONTROLS_WIDTH
  return availableWidth >= required ? 'expanded' : 'compact'
}

/** Header utilities plus grouped render-mode and Session actions. */
export function ChatRenderMenu({ modes, activeId, onPick, renderUtilities, t }: ChatRenderMenuProps) {
  const [open, setOpen] = useState(false)
  const [availableWidth, setAvailableWidth] = useState<number | null>(null)
  const [sessionLogBusy, setSessionLogBusy] = useState(false)
  const seatRef = useRef<HTMLDivElement>(null)
  const sessionLogHostRef = useRef<HTMLDivElement>(null)
  const panelControls = availableWidth === null ? 'compact' : panelControlsMode(availableWidth)
  const closeMenu = () => { setOpen(false) }

  useLayoutEffect(() => {
    const element = seatRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const publish = (width: number) => { setAvailableWidth(previous => previous === width ? previous : width) }
    publish(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(entries => {
      const entry = entries.at(-1)
      if (entry !== undefined) publish(entry.contentRect.width)
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  const utilityOwner = { panelControls }
  const inlinePanels = renderUtilities(
    'conversation.session.header.utilities',
    utilityOwner,
    { only: 'workbench-controls' },
  )
  // Keep the official controller/dialog contribution mounted permanently.
  // Its original capsule is hidden; the grouped Menu row below forwards one
  // click to that public control, preserving its busy state and modal.
  const sessionLogAction = renderUtilities(
    'conversation.session.header.utilities',
    utilityOwner,
    { only: 'session-log-download' },
  )

  useLayoutEffect(() => {
    const host = sessionLogHostRef.current
    if (host === null || typeof MutationObserver === 'undefined') return
    const sync = () => {
      const button = host.querySelector<HTMLButtonElement>('button')
      setSessionLogBusy(button?.disabled === true || button?.getAttribute('aria-busy') === 'true')
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(host, { subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-busy'] })
    return () => { observer.disconnect() }
  }, [sessionLogAction])

  const items: MenuEntry[] = [
    { type: 'label', id: 'render-label', text: t('chat.more.renderGroup') },
    ...modes.map(mode => ({ id: `render:${mode.id}`, label: mode.label })),
    { type: 'separator', id: 'session-separator' },
    { type: 'label', id: 'session-label', text: t('chat.more.sessionGroup') },
    {
      id: 'session-log-download',
      label: t('chat.more.sessionLog'),
      icon: <IconDownloadOutline16 />,
      disabled: sessionLogBusy,
    },
  ]

  return (
    <div ref={seatRef} className={clsx(css.seat, open && css.menuOpen)}>
      <div className={css.inlineHost}>{inlinePanels}</div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={items}
        selectedId={`render:${activeId}`}
        onSelect={(id) => {
          if (id.startsWith('render:')) onPick(id.slice('render:'.length))
          if (id === 'session-log-download') {
            sessionLogHostRef.current?.querySelector<HTMLButtonElement>('button')?.click()
          }
          closeMenu()
        }}
        portal
        align="end"
        anchor={(
          <Tooltip label={t('chat.render.hint')} side="bottom" delayMs={500}>
            <button
              type="button"
              className={css.trigger}
              aria-label={t('chat.render.aria')}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => { setOpen(value => !value) }}
            >
              <IconEllipsisOutline16 size={ICON_TOOLBAR_GLYPH_SIZE} />
            </button>
          </Tooltip>
        )}
      />
      <div ref={sessionLogHostRef} className={css.sessionLogHost} aria-hidden="true">
        {sessionLogAction}
      </div>
    </div>
  )
}
