import type { CSSProperties, HTMLAttributes } from 'react'
import clsx from 'clsx'
import { resolveFileIcon } from './file-icon.ts'
import css from './FileIcon.module.css'

export interface FileIconProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  path: string
  size?: number | undefined
}

/** Decorative, offline Material Icon Theme file glyph. */
export function FileIcon({ path, size = 14, className, style, ...props }: FileIconProps) {
  const icon = resolveFileIcon(path)
  const sizedStyle: CSSProperties = { ...style, width: size, height: size }
  const themed = icon.name !== icon.lightName
  return (
    <span
      {...props}
      className={clsx(css.icon, className)}
      style={sizedStyle}
      aria-hidden
      data-file-icon={icon.name}
      data-file-icon-light={icon.lightName}
    >
      <img className={themed ? css.dark : css.image} src={icon.source} alt="" draggable={false} />
      {themed && <img className={css.light} src={icon.lightSource} alt="" draggable={false} />}
      <svg className={css.forcedColors} viewBox="0 0 16 16" fill="none">
        <path d="M3 1.75h6l4 4V14.25H3z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        <path d="M9 1.75v4h4" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

export interface FileLabelProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  path: string
  label?: string | undefined
  iconSize?: number | undefined
  textClassName?: string | undefined
}

/** Shared one-line file identity: decorative glyph plus accessible text. */
export function FileLabel({ path, label = path, iconSize = 14, className, textClassName, ...props }: FileLabelProps) {
  return (
    <span {...props} className={clsx(css.label, className)}>
      <FileIcon path={path} size={iconSize} />
      <span className={clsx(css.text, textClassName)}>{label}</span>
    </span>
  )
}
