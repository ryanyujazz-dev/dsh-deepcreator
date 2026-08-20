import { useLayoutEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import css from './OverflowFadeText.module.css'

export interface OverflowFadeTextProps {
  text: string
  /** Paths preserve their trailing basename; prose preserves its leading words. */
  fade: 'left' | 'right'
  className?: string | undefined
}

/** One-line text that applies a directional edge fade only while genuinely clipped. */
export function OverflowFadeText({ text, fade, className }: OverflowFadeTextProps) {
  const viewportRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [truncated, setTruncated] = useState(false)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const content = contentRef.current
    if (viewport === null || content === null) return
    const measure = () => { setTruncated(content.scrollWidth > viewport.clientWidth) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    observer.observe(content)
    return () => { observer.disconnect() }
  }, [text])

  return (
    <span
      ref={viewportRef}
      className={clsx(css.viewport, className)}
      data-overflow-fade={fade}
      data-truncated={truncated || undefined}
      title={text}
    >
      <span ref={contentRef} className={css.ink}>{text}</span>
    </span>
  )
}
