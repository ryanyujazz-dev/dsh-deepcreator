// CodeSurface: the panel-grade read-only file surface — line-numbered,
// syntax-colored source that folds to the panel width. Row geometry mirrors
// DiffBlock's aligned grid (one number gutter + content column, no sign
// column) while the content cell trades ReadBlock's horizontal scroll for
// soft wrap: panel artifacts are prose-adjacent (markdown, config), so a long
// line should fold, not run off-screen. The surface paints no background of
// its own — the full-size panel body keeps the shell surface (style guide),
// with token colors resolving through the shared --shiki-*/--ds-* chain.

import { useMemo, useSyncExternalStore } from 'react'
import {
  grammarLoadCount,
  highlightLines,
  subscribeGrammarLoaded,
  type HighlightSpan,
} from './markdown/highlight.ts'
import css from './CodeSurface.module.css'

export interface CodeSurfaceProps {
  /** Source text; one trailing newline does not create a phantom last line. */
  content: string
  /** Grammar hint (a file-extension-derived language id); unknown or absent renders plain monospace. */
  lang?: string | undefined
}

/**
 * Render one line's highlighted runs. The css-variables theme colors every
 * run, so each run is a styled span; a line with no highlighting at all takes
 * the bare-text path in the caller instead (unknown language).
 * @param spans - the line's styled runs.
 * @returns the line's children.
 */
function renderSpans(spans: readonly HighlightSpan[]) {
  return spans.map((span, index) => <span key={index} data-code-token="" style={span.style}>{span.text}</span>)
}

/**
 * Render a whole source file as a wrapped, line-numbered, colored surface.
 * @param props - see {@link CodeSurfaceProps}.
 * @returns the surface element.
 */
export function CodeSurface({ content, lang }: CodeSurfaceProps) {
  // Tokenize the whole file in one call so grammar context (multi-line
  // strings, fenced blocks) survives across lines; a trailing newline's
  // phantom row is dropped so the row count matches the editor's line count.
  const lines = useMemo(
    () => (content === '' ? [] : content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')),
    [content],
  )
  const raw = useMemo(() => lines.join('\n'), [lines])
  // Re-render when a lazy grammar finishes loading, so a file that showed
  // plain text while its language's grammar imported picks up highlighting.
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const highlighted = useMemo(() => highlightLines(raw, lang), [raw, lang, loaded])

  return (
    <div className={css.surface} data-code-surface="">
      {lines.map((text, index) => (
        <div key={index} className={css.line}>
          <span className={css.gutter} aria-hidden>{index + 1}</span>
          <span className={css.content}>{highlighted?.[index] === undefined ? text : renderSpans(highlighted[index])}</span>
        </div>
      ))}
    </div>
  )
}
