import { useState } from 'react'
import {
  ConversationFileCardAction, IconChevronDownOutline14, Menu, type MenuEntry,
} from '@ryanyujazz/dsh-client-ui-primitives'
import css from './HtmlArtifactOpenControl.module.css'

export function HtmlArtifactOpenControl({ path, openInDeepCreator, openInSystemBrowser, onError, t }: {
  path: string
  openInDeepCreator(): Promise<void>
  openInSystemBrowser(): Promise<void>
  onError(message: string | null): void
  t(key: 'open' | 'openMenu' | 'openInDeepCreator' | 'openInSystemBrowser'): string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [opening, setOpening] = useState(false)
  const run = (action: () => Promise<void>) => {
    if (opening) return
    setOpening(true)
    onError(null)
    void action().catch(reason => { onError(reason instanceof Error ? reason.message : String(reason)) })
      .finally(() => { setOpening(false) })
  }
  const items: MenuEntry[] = [
    { id: 'deepcreator', label: t('openInDeepCreator') },
    { id: 'system', label: t('openInSystemBrowser') },
  ]
  return (
    <Menu
      open={menuOpen}
      onClose={() => { setMenuOpen(false) }}
      items={items}
      onSelect={(id) => {
        setMenuOpen(false)
        run(id === 'system' ? openInSystemBrowser : openInDeepCreator)
      }}
      portal
      compact
      align="end"
      anchor={(
        <span className={css.openSplit} data-artifact-html-open={path} data-opening={opening || undefined}>
          <ConversationFileCardAction className={css.openPrimary} disabled={opening} onClick={() => { run(openInDeepCreator) }}>
            {t('open')}
          </ConversationFileCardAction>
          <button
            type="button"
            className={css.openMenu}
            aria-label={t('openMenu')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={opening}
            onClick={() => { setMenuOpen(value => !value) }}
          >
            <IconChevronDownOutline14 size={12} />
          </button>
        </span>
      )}
    />
  )
}
