import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import css from './WorkbenchPanelTabs.module.css'

function CloseIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>
}

export interface WorkbenchPanelTabsProps {
  tabs: readonly string[]
  activeTab?: string
  closeTabLabel(tab: string): string
  onActivateTab(tab: string): void
  onCloseTab(tab: string): void
  trailingAction?: ReactNode
}

/** Business-state-free pill tabs shared by every Workbench Panel type. */
export function WorkbenchPanelTabs({
  tabs, activeTab, closeTabLabel, onActivateTab, onCloseTab, trailingAction,
}: WorkbenchPanelTabsProps) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const delta = event.key === 'ArrowRight' ? 1 : -1
    const current = activeTab === undefined ? (delta > 0 ? -1 : 0) : tabs.indexOf(activeTab)
    const next = tabs[(current + delta + tabs.length) % tabs.length]
    if (next === undefined) return
    event.preventDefault()
    onActivateTab(next)
  }

  return (
    <div className={css.strip}>
      <div className={css.tabs} role="tablist" onKeyDown={onKeyDown}>
        {tabs.map(tab => {
          const active = tab === activeTab
          return (
            <div key={tab} className={clsx(css.tab, active && css.tabActive)}>
              <button
                type="button"
                className={css.tabLabel}
                role="tab"
                aria-selected={active}
                tabIndex={active || (activeTab === undefined && tab === tabs[0]) ? 0 : -1}
                onClick={() => { onActivateTab(tab) }}
              >
                <span>{tab}</span>
              </button>
              <button type="button" className={css.tabClose} aria-label={closeTabLabel(tab)} onClick={() => { onCloseTab(tab) }}><CloseIcon /></button>
            </div>
          )
        })}
      </div>
      {trailingAction !== undefined && <span className={css.trailingAction}>{trailingAction}</span>}
    </div>
  )
}
