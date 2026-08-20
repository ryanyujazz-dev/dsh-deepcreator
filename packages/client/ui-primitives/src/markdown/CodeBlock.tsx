// CodeBlock: one code surface for every consumer — markdown fences, the
// run_code program body, and the details panel's raw args/output — with
// shiki highlighting for the registered grammars and an identical-geometry
// plain fallback for everything else. Chrome (language banner + copy) matches
// deepsuite `@deepseek/md` code blocks; token colors stay on `--shiki-*`.

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard.ts'
import { IconCheckOutline16, IconCopyOutline16 } from '../icons/index.tsx'
import { Tooltip } from '../Tooltip.tsx'
import { grammarLoadCount, highlightToHtml, subscribeGrammarLoaded } from './highlight.ts'
import css from './CodeBlock.module.css'

export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /** Optional visible card title, independent from the grammar hint while a markdown stream is still plain. */
  title?: string | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Copy-button idle label; the owner passes localized copy (this package is cordis-free, so copy arrives via props). */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

export function CodeBlock({ code, lang, title, className, copyLabel = '复制', copiedLabel = '复制成功' }: CodeBlockProps) {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  // Re-render when a lazy grammar finishes loading, so a fence that showed plain
  // text while its language's grammar imported picks up highlighting. The
  // snapshot value is opaque; only its change across renders drives the memo.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const html = useMemo(() => highlightToHtml(trimmed, lang), [trimmed, lang, loaded])
  const rootRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const bannerLabel = title ?? lang ?? ''
  const hasTitle = bannerLabel.trim() !== ''

  const onCopy = useCallback(() => {
    if (copied) return
    /* v8 ignore next -- both arms always mount a <pre>; trimmed is the
       typed fallback if the DOM shape ever diverges. */
    const text = rootRef.current?.querySelector('pre')?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, trimmed])

  const body = html === undefined
    ? (
      <pre className={css.plain}><code>{trimmed}</code></pre>
    )
    : (
  // shiki's output is a static span tree it generated from `code` (no user
  // HTML passes through), the sanctioned innerHTML consumption path per
  // shiki's own docs.
      <div dangerouslySetInnerHTML={{ __html: html }} />
    )

  const copyControl = (
    <Tooltip label={copied ? copiedLabel : copyLabel} side="bottom">
      <button
        type="button"
        className={clsx(css.copyButton, !hasTitle && css.floatingCopy)}
        aria-label={copied ? copiedLabel : copyLabel}
        onClick={onCopy}
      >
        {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
      </button>
    </Tooltip>
  )

  return (
    <div ref={rootRef} className={clsx(css.block, 'md-code-block', className)} data-titleless={hasTitle ? undefined : ''}>
      {hasTitle
        ? (
          <div className={css.bannerWrap} data-code-title="">
            <div className={css.banner}>
              <div className={css.infostring}>{bannerLabel}</div>
              <div className={css.action}>{copyControl}</div>
            </div>
          </div>
        )
        : copyControl}
      {body}
    </div>
  )
}
