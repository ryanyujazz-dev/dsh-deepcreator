/**
 * ExecDisclosureRow: vendored DisclosureRow for the execflow tab with ONE
 * visual behavior change — the leading glyph keeps showing the row's own
 * icon in EVERY state (collapsed and expanded alike); the chevron appears
 * only on hover, exactly as it does when collapsed. It also exposes a
 * non-disclosure row-action seam so the identical chrome can navigate; that
 * action uses an upward hover chevron without changing disclosure directions.
 */
import { type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconChevronUpOutline14,
} from '@ryanyujazz/dsh-client-ui-primitives'
import css from './ExecDisclosureRow.module.css'

/** Shared 24px disclosure chrome for compact flow rows. */
export interface ExecDisclosureRowProps {
  icon: ReactNode
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Makes the complete row a non-disclosure action with this accessible name. */
  actionLabel?: string | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: ReactNode
  children?: ReactNode
  className?: string | undefined
  rowClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function ExecDisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  actionLabel,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: ExecDisclosureRowProps) {
  const rowExpands = expandable && expandOnRowClick
  const rowActs = actionLabel !== undefined
  const rowInteractive = rowExpands || rowActs
  const toggleFromLeading = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rowInteractive || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  // The single deviation from the primitive: the icon stays in every state;
  // the chevron is a hover overlay always (never the resting glyph) and its
  // direction tells the click's effect — an action points up into Think mode;
  // disclosures keep pointing right while collapsed and down while expanded.
  const hoverChevronDirection = rowActs ? 'up' : open ? 'down' : 'right'
  const hoverChevron = hoverChevronDirection === 'up'
    ? <IconChevronUpOutline14 className={clsx(chevronClassName, css.chevronHover)} />
    : hoverChevronDirection === 'down'
      ? <IconChevronDownOutline14 className={clsx(chevronClassName, css.chevronHover)} />
      : <IconChevronRightOutline14 className={clsx(chevronClassName, css.chevronHover)} />
  const leading = expandable
    ? (
      <>
        <span className={css.iconIdle}>{icon}</span>
        {hoverChevron}
      </>
    )
    : icon

  return (
    <div className={clsx(css.root, className)} data-open={open || undefined}>
      <div
        className={clsx(css.row, rowClassName)}
        data-disclosure-row
        data-interactive={rowInteractive || undefined}
        data-hover-chevron={expandable ? hoverChevronDirection : undefined}
        role={rowInteractive ? 'button' : undefined}
        tabIndex={rowInteractive ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        aria-label={actionLabel}
        onClick={rowInteractive ? onToggle : undefined}
        onKeyDown={rowInteractive ? toggleFromKeyboard : undefined}
      >
        {expandable && !rowInteractive ? (
          <button
            type="button"
            className={clsx(css.leading, leadingClassName)}
            aria-expanded={open}
            onClick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span className={clsx(css.leading, leadingClassName)}>
            {leading}
          </span>
        )}
        <span className={clsx(css.title, titleClassName)}>{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </div>
      {open && children}
    </div>
  )
}
