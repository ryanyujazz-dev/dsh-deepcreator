import type {
  ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode,
} from 'react'
import clsx from 'clsx'
import { Tooltip } from './Tooltip.tsx'
import { DeepCreatorIconPanelCollapse16, DeepCreatorIconPanelExpand16 } from './icons/deepcreator.tsx'
import css from './WorkbenchPanelShell.module.css'

type PanelRoute = 'home' | 'instance'

function BackIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M10.5 3L5.5 8l5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
}

function CloseIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>
}

export interface WorkbenchPanelIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'title'> {
  label: string
  children: ReactNode
}

/** Shared 28px Header action used by the shell and all Panel Providers. */
export function WorkbenchPanelIconButton({
  label, children, className, type = 'button', ...props
}: WorkbenchPanelIconButtonProps) {
  return (
    <Tooltip label={label} side="bottom" delayMs={500}>
      <button {...props} type={type} className={clsx(css.iconButton, className)} aria-label={label}>{children}</button>
    </Tooltip>
  )
}

export interface WorkbenchPanelShellProps {
  typeId: string
  label: string
  route: PanelRoute
  tabs: readonly string[]
  activeInstanceId?: string
  supportsHome: boolean
  focused: boolean
  backLabel: string
  focusLabel: string
  restoreLabel: string
  closeGroupLabel: string
  closeTabLabel(tab: string): string
  onShowHome(): void
  onActivateTab(tab: string): void
  onCloseTab(tab: string): void
  onHide(): void
  onFocus(): void
  onRestore(): void
  leftActions?: ReactNode
  rightActions?: ReactNode
  children: ReactNode
  disconnected?: ReactNode
}

/**
 * The one visual frame for every Workbench cell. The Mosaic parent owns only
 * geometry; margins, outline, Header, tabs, actions and Body live here.
 */
export function WorkbenchPanelShell({
  typeId, label, route, tabs, activeInstanceId, supportsHome, focused,
  backLabel, focusLabel, restoreLabel, closeGroupLabel, closeTabLabel,
  onShowHome, onActivateTab, onCloseTab, onHide, onFocus, onRestore,
  leftActions, rightActions, children, disconnected,
}: WorkbenchPanelShellProps) {
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const current = activeInstanceId === undefined ? -1 : tabs.indexOf(activeInstanceId)
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const next = tabs[(current + delta + tabs.length) % tabs.length]
    if (next !== undefined) onActivateTab(next)
  }

  return (
    <section className={css.shell} data-type={typeId} aria-label={label}>
      <header className={css.header}>
        <div className={css.leading}>
          <strong className={css.title}>{label}</strong>
          {leftActions !== undefined && <span className={css.leftActions}>{leftActions}</span>}
        </div>
        {tabs.length > 0 && (
          <div className={css.tabs} role="tablist" onKeyDown={onTabKeyDown}>
            {tabs.map(tab => (
              <div key={tab} className={clsx(css.tab, route === 'instance' && tab === activeInstanceId && css.tabActive)}>
                <button type="button" role="tab" aria-selected={route === 'instance' && tab === activeInstanceId} onClick={() => { onActivateTab(tab) }}><span>{tab}</span></button>
                <button type="button" className={css.tabClose} aria-label={closeTabLabel(tab)} onClick={() => { onCloseTab(tab) }}><CloseIcon /></button>
              </div>
            ))}
          </div>
        )}
        <div className={css.headerActions}>
          {rightActions !== undefined && <span className={css.rightActions}>{rightActions}</span>}
          {supportsHome && route === 'instance' && (
            <WorkbenchPanelIconButton label={backLabel} onClick={onShowHome}><BackIcon /></WorkbenchPanelIconButton>
          )}
          <WorkbenchPanelIconButton label={focused ? restoreLabel : focusLabel} onClick={focused ? onRestore : onFocus}>
            {focused ? <DeepCreatorIconPanelCollapse16 size={14} /> : <DeepCreatorIconPanelExpand16 size={14} />}
          </WorkbenchPanelIconButton>
          <WorkbenchPanelIconButton label={closeGroupLabel} onClick={onHide}><CloseIcon /></WorkbenchPanelIconButton>
        </div>
      </header>
      <div className={css.body}>
        {children}
        {disconnected}
      </div>
    </section>
  )
}
