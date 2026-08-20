import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import {
  IconChevronDownOutline14, IconChevronRightOutline14,
} from './icons/index.tsx'
import { FileIcon } from './file-icons/FileIcon.tsx'
import css from './ConversationFileCard.module.css'

export interface ConversationFileCardProps {
  icon: ReactNode
  label: ReactNode
  expanded: boolean
  onToggle: () => void
  active?: boolean
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  sectionProps?: HTMLAttributes<HTMLElement>
}

/** Shared Turn-tail card frame for produced files and repository changes. */
export function ConversationFileCard({
  icon, label, expanded, onToggle, active = true, meta, actions, children, sectionProps,
}: ConversationFileCardProps) {
  return (
    <section
      {...sectionProps}
      className={[css.card, sectionProps?.className].filter(Boolean).join(' ')}
      data-active={active || undefined}
    >
      <div className={css.header}>
        <button
          type="button"
          className={css.summary}
          disabled={!active}
          aria-expanded={active ? expanded : undefined}
          onClick={onToggle}
        >
          <span className={css.leadingIcon} data-conversation-file-card-leading-icon>
            <span className={css.primaryIcon}>{icon}</span>
            {expanded
              ? <IconChevronDownOutline14 size={13} className={css.chevronIcon} />
              : <IconChevronRightOutline14 size={13} className={css.chevronIcon} />}
          </span>
          <span className={css.label}>{label}</span>
          {meta}
        </button>
        {actions !== undefined && <div className={css.actions}>{actions}</div>}
      </div>
      {active && expanded && children}
    </section>
  )
}

export type ConversationFileCardActionProps = ButtonHTMLAttributes<HTMLButtonElement>

/** Header action sharing the transparent 28px Turn-card treatment. */
export function ConversationFileCardAction({ className, type = 'button', ...props }: ConversationFileCardActionProps) {
  return <button {...props} type={type} className={[css.action, className].filter(Boolean).join(' ')} />
}

export interface ConversationFileCardFileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  path: string
  trailing?: ReactNode
}

/** One full-width file row inside a Turn-tail file card. */
export function ConversationFileCardFile({ path, trailing, className, type = 'button', children, ...props }: ConversationFileCardFileProps) {
  return (
    <li>
      <button {...props} type={type} className={[css.file, className].filter(Boolean).join(' ')}>
        <span className={css.fileIcon}><FileIcon path={path} /></span>
        <span className={css.filePath}>{children ?? path}</span>
        {trailing}
      </button>
    </li>
  )
}

/** Divided file-list body shared by Turn-tail cards. */
export function ConversationFileCardList({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul {...props} className={[css.files, className].filter(Boolean).join(' ')} />
}
