import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import clsx from 'clsx'
import { Tooltip } from './Tooltip.tsx'
import { FileIcon } from './file-icons/FileIcon.tsx'
import css from './WorkbenchPanelTabs.module.css'

function CloseIcon() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>
}

export interface WorkbenchPanelTabsProps {
  tabs: readonly string[]
  /** Provider display names per tab id; unmapped tabs show their id. */
  labels?: Readonly<Record<string, string>> | undefined
  /** Real file identities for tabs whose display label is a basename. */
  filePaths?: Readonly<Record<string, string>> | undefined
  activeTab?: string
  closeTabLabel(tab: string): string
  onActivateTab(tab: string): void
  onCloseTab(tab: string): void
  trailingAction?: ReactNode
}

/** One pill: content-sized while the strip has room, compressed with a right-edge fade when not. */
function TabPill({
  label, filePath, active, first, tab, closeTabLabel, onActivateTab, onCloseTab,
}: {
  label: string
  filePath?: string | undefined
  active: boolean
  first: boolean
  tab: string
  closeTabLabel: WorkbenchPanelTabsProps['closeTabLabel']
  onActivateTab: WorkbenchPanelTabsProps['onActivateTab']
  onCloseTab: WorkbenchPanelTabsProps['onCloseTab']
}) {
  const spanRef = useRef<HTMLSpanElement | null>(null)
  const [truncated, setTruncated] = useState(false)
  // Fade only pills whose label actually clips: measure on mount, on label
  // change, and on any later resize (the strip compresses pills dynamically).
  // Environments without ResizeObserver (jsdom) keep the one-shot measurement.
  useLayoutEffect(() => {
    const el = spanRef.current
    if (el === null) return
    const measure = () => { setTruncated(el.scrollWidth > el.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [label])

  return (
    <div className={clsx(css.tab, active && css.tabActive)} data-truncated={truncated || undefined}>
      <Tooltip label={label} side="bottom" delayMs={500} maxWidth={320}>
        <button
          type="button"
          className={css.tabLabel}
          role="tab"
          aria-selected={active}
          tabIndex={active || first ? 0 : -1}
          onClick={() => { onActivateTab(tab) }}
        >
          {filePath !== undefined && <FileIcon path={filePath} />}
          <span ref={spanRef} className={css.tabText}>{label}</span>
        </button>
      </Tooltip>
      <button type="button" className={css.tabClose} aria-label={closeTabLabel(tab)} onClick={() => { onCloseTab(tab) }}><CloseIcon /></button>
    </div>
  )
}

/** Business-state-free pill tabs shared by every Workbench Panel type. */
export function WorkbenchPanelTabs({
  tabs, labels, filePaths, activeTab, closeTabLabel, onActivateTab, onCloseTab, trailingAction,
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
        {tabs.map(tab => (
          <TabPill
            key={tab}
            tab={tab}
            label={labels?.[tab] ?? tab}
            filePath={filePaths?.[tab]}
            active={tab === activeTab}
            first={activeTab === undefined ? tab === tabs[0] : tab === activeTab}
            closeTabLabel={closeTabLabel}
            onActivateTab={onActivateTab}
            onCloseTab={onCloseTab}
          />
        ))}
      </div>
      {trailingAction !== undefined && <span className={css.trailingAction}>{trailingAction}</span>}
    </div>
  )
}
