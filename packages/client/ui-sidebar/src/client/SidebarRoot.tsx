/**
 * Sidebar shell: column geometry only. Collapse is a slide plus crossfade:
 * content freezes at its expanded width (inline style) and fades out in place
 * while the sliding column (AppFrame grid tracks) clips it — nothing reflows
 * mid-slide. At settle the wide-only content unmounts, the column closes to
 * zero, and the layout-owned frame control becomes the
 * sole reopen affordance. The bottom-pinned settings control also fades. The
 * workspace/session browsing region between
 * the New Session button and the foot is the `sidebar.workspaces` registrant's,
 * and the foot holds `sidebar.settings` plus `sidebar.footer.action`; the shell
 * hands them the wide flag (plus an expand request callback for the browser).
 *
 * The column also owns whether the scroll regions nested in it draw a
 * scrollbar at all: the shell tracks the pointer and rebinds ui-theme's
 * scrollbar indirection away while it is elsewhere, so a list the user is not
 * pointing at carries no bar.
 */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  BrandWordmark, DeepCreatorIconTimer16,
  IconNewChatOutline16, IconPanelLeftOutline16,
  SIDEBAR_ICON_SIZE, SidebarRow, Tooltip,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { SidebarClosedToggleComponentProps, SidebarRootComponentProps } from './contract/slots.ts'
import css from './SidebarRoot.module.css'

/** Wide-content unmount delay; matches the 150ms wide-content fade-out. */
const COLLAPSE_SETTLE_MS = 150

/**
 * How long the column's scrollbars stay drawn after the pointer leaves it.
 * The bar is a pointer affordance here, and hiding it on the leave event
 * itself makes it blink out while the pointer is only crossing the column's
 * edge — on the way to the conversation, or around a portalled menu.
 */
const SCROLLBAR_LINGER_MS = 2000

/**
 * Render the sidebar column shell.
 * @param props - composed slot props (runtime share + injected callbacks, contract/slots.ts).
 * @returns the sidebar element tree.
 */
export function SidebarRoot({
  collapsed,
  width,
  startSession,
  toggleSidebar,
  t,
  renderSlot,
}: SidebarRootComponentProps) {
  // Wide content stays mounted while the collapse animates (fading via
  // .collapsed .wide), unmounts at settle, and remounts right away on expand.
  const [settled, setSettled] = useState(collapsed)
  useEffect(() => {
    if (!collapsed) { setSettled(false); return }
    const timer = window.setTimeout(() => { setSettled(true) }, COLLAPSE_SETTLE_MS)
    return () => { window.clearTimeout(timer) }
  }, [collapsed])
  const wide = !collapsed || !settled

  // Freeze the content at its expanded width while it fades out (collapsed
  // && wide): the sliding column then clips it instead of reflowing it. The
  // component returns no DOM once the fade settles.
  const lastWideWidth = useRef(width)
  if (!collapsed) lastWideWidth.current = width

  // Scrollbars in the column follow the pointer (.quietBars rebinds them
  // away): drawn while it is inside, and for SCROLLBAR_LINGER_MS after it
  // leaves. A pointer that returns within that window cancels the pending
  // hide rather than restarting from a hidden bar.
  const column = useRef<HTMLDivElement>(null)
  const [pointerInside, setPointerInside] = useState(false)
  const lingerTimer = useRef<number | undefined>(undefined)
  const armLinger = (): void => {
    if (lingerTimer.current !== undefined) return
    lingerTimer.current = window.setTimeout(() => {
      lingerTimer.current = undefined
      setPointerInside(false)
    }, SCROLLBAR_LINGER_MS)
  }
  const cancelLinger = (): void => {
    window.clearTimeout(lingerTimer.current)
    lingerTimer.current = undefined
  }
  // Leaving is decided by the column's BOX, not by DOM containment, and only
  // while the bars are drawn. ui-settings renders its full-viewport panel as a
  // fixed-position DESCENDANT of this column, so a pointer moved onto that
  // panel — or onto the conversation once it closes — fires no `pointerleave`
  // here, and the bars would stay drawn over a column nobody is pointing at.
  // The element's own leave stays as the one signal geometry cannot give: a
  // pointer that leaves the window emits no further moves.
  useEffect(() => {
    if (!pointerInside) return
    const onMove = (event: PointerEvent): void => {
      const rect = column.current?.getBoundingClientRect()
      /* v8 ignore next -- the listener only exists while the column is mounted and revealed. */
      if (rect === undefined) return
      const inside = event.clientX >= rect.left && event.clientX < rect.right
        && event.clientY >= rect.top && event.clientY < rect.bottom
      if (inside) cancelLinger()
      else armLinger()
    }
    document.addEventListener('pointermove', onMove)
    return () => {
      document.removeEventListener('pointermove', onMove)
      cancelLinger()
    }
  }, [pointerInside])

  // During the short visual exit the shrinking column is already closed for
  // interaction. Native inert keeps its fading controls out of pointer and
  // keyboard navigation; after settle this component renders no DOM at all.
  useEffect(() => {
    const element = column.current
    if (element === null) return
    if (collapsed) element.setAttribute('inert', '')
    else element.removeAttribute('inert')
  }, [collapsed])

  if (collapsed && settled) return null

  return (
    <div
      ref={column}
      className={clsx(
        css.root, collapsed && css.fading, !pointerInside && css.quietBars,
      )}
      style={wide ? { width: collapsed ? lastWideWidth.current : width } : undefined}
      onPointerEnter={() => {
        cancelLinger()
        setPointerInside(true)
      }}
      onPointerLeave={() => { armLinger() }}
      aria-hidden={collapsed || undefined}
    >
      <div className={css.logoRow}>
        {/* Expanded, the wordmark doubles as a New Session shortcut. The
            closed state has no sidebar DOM; its toggle lives in frame chrome. */}
        {wide && (
          <button
            type="button"
            className={clsx(css.brand, css.wide)}
            aria-label={t('session.new.label')}
            onClick={() => { startSession() }}
          >
            <BrandWordmark />
          </button>
        )}
        {/* Rail resting state is the whale mark; hovering swaps in the panel
            icon (the expand affordance, figma sidebar-hover flow). */}
        <Tooltip label={collapsed ? t('toggle.open') : t('toggle.collapse')} delayMs={500}>
          <button
            type="button"
            className={clsx(css.iconButton, css.toggle)}
            aria-label={collapsed ? t('toggle.open') : t('toggle.collapse')}
            onClick={() => { toggleSidebar() }}
          >
            <IconPanelLeftOutline16 className={css.panelIcon} size={SIDEBAR_ICON_SIZE} />
          </button>
        </Tooltip>
      </div>

      {/* Stage-mode switch seat (对话｜应用): rendered by its owner (the
          layout plugin contributes the control bound to the layout store),
          placed under the Brand row and outside the primary action list —
          a mode toggle is shell chrome, not a feature action. */}
      {renderSlot('sidebar.stage-mode', { wide })}

      {/* Shell-owned New Session and Scheduled Tasks rows frame a list of
          independently disposable feature actions. */}
      <ul className={css.primaryList} aria-label={t('primary.aria')}>
        <li className={css.primaryListItem}>
          <Tooltip label={t('session.new.label')} delayMs={500} disabled={wide}>
            <SidebarRow
              as="button"
              type="button"
              className={css.newSession}
              aria-label={t('session.new.label')}
              onClick={() => { startSession() }}
            >
              <IconNewChatOutline16 size={SIDEBAR_ICON_SIZE} />
              {wide && <span className={clsx(css.primaryLabel, css.wide)}>{t('session.new')}</span>}
            </SidebarRow>
          </Tooltip>
        </li>
        {renderSlot('sidebar.primary.action', { wide })}
        <li className={css.primaryListItem}>
          <SidebarRow
            as="button"
            type="button"
            className={css.scheduledTasksPlaceholder}
            aria-label={t('scheduledTasks.placeholder.label')}
            disabled
          >
            <DeepCreatorIconTimer16 size={SIDEBAR_ICON_SIZE} />
            {wide && <span className={clsx(css.primaryLabel, css.wide)}>{t('scheduledTasks')}</span>}
          </SidebarRow>
        </li>
      </ul>

      {/* The browsing region fills the expanded column between controls and foot. */}
      <div className={css.regionArea}>
        {renderSlot('sidebar.workspaces', {
          wide,
          expandSidebar: () => { if (collapsed) toggleSidebar() },
        })}
      </div>

      {/* Footer actions stack above Settings in both sidebar widths. */}
      <div className={css.footArea}>
        <div className={css.footerActions}>
          {renderSlot('sidebar.footer.action', { wide })}
        </div>
        <div className={css.settingsArea}>
          {renderSlot('sidebar.settings', { wide })}
        </div>
      </div>
    </div>
  )
}

/** Reopen control rendered by the layout's stable frame-chrome seat. */
export function SidebarClosedToggle({ toggleSidebar, t }: SidebarClosedToggleComponentProps) {
  return (
    <Tooltip label={t('toggle.open')} delayMs={500}>
      <button
        type="button"
        className={clsx(css.iconButton, css.closedToggle)}
        aria-label={t('toggle.open')}
        onClick={() => { toggleSidebar() }}
      >
        <IconPanelLeftOutline16 size={SIDEBAR_ICON_SIZE} />
      </button>
    </Tooltip>
  )
}
