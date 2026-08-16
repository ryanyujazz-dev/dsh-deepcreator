import { forwardRef } from 'react'
import type {
  ButtonHTMLAttributes, ForwardedRef, HTMLAttributes, ReactNode,
} from 'react'
import clsx from 'clsx'
import css from './SidebarRow.module.css'

interface SidebarRowSharedProps {
  /** Row content laid out on the shared sidebar baseline. */
  children: ReactNode
  /** Feature-owned state or placement classes. */
  className?: string | undefined
}

type SidebarRowDivProps = SidebarRowSharedProps
  & { as?: 'div' }
  & Omit<HTMLAttributes<HTMLDivElement>, keyof SidebarRowSharedProps>

type SidebarRowButtonProps = SidebarRowSharedProps
  & { as: 'button' }
  & Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof SidebarRowSharedProps>

/** Shared 32px sidebar row chrome without feature behavior or tree semantics. */
export type SidebarRowProps = SidebarRowDivProps | SidebarRowButtonProps

/**
 * Render the common sidebar row geometry as a neutral div or button.
 * @param props - Element kind, feature attributes, and row content.
 * @returns a sidebar row with shared height, spacing, typography, and hover fill.
 */
function SidebarRowComponent(
  props: SidebarRowProps,
  ref: ForwardedRef<HTMLButtonElement | HTMLDivElement>,
) {
  if (props.as === 'button') {
    const { as: _as, className, children, ...buttonProps } = props
    return (
      <button
        ref={ref as ForwardedRef<HTMLButtonElement>}
        className={clsx(css.row, className)}
        {...buttonProps}
      >
        {children}
      </button>
    )
  }
  const { as: _as, className, children, ...divProps } = props
  return (
    <div
      ref={ref as ForwardedRef<HTMLDivElement>}
      className={clsx(css.row, className)}
      {...divProps}
    >
      {children}
    </div>
  )
}

/** Shared sidebar row with its concrete element ref forwarded to shell chrome. */
export const SidebarRow = forwardRef(SidebarRowComponent)
SidebarRow.displayName = 'SidebarRow'
