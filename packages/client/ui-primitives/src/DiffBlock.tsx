import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import { buildDiffHunkModel, type AlignedRow, type DiffHunkInput, type TextRange } from './diff/model.ts'
import {
  grammarLoadCount, subscribeGrammarLoaded, type HighlightSpan,
} from './markdown/highlight.ts'
import css from './DiffBlock.module.css'

export const DEFAULT_DIFF_MAX_LINES = 16

export interface DiffHunk extends DiffHunkInput {}

export interface DiffBlockLabels {
  copy: string
  copied: string
  expand: (count: number) => string
  collapse: string
  expandContext: (count: number) => string
  addedLine: (line: number | null, text: string) => string
  deletedLine: (line: number | null, text: string) => string
  contextLine: (line: number | null, text: string) => string
}

export interface DiffBlockProps {
  diffs: readonly DiffHunk[]
  maxLines?: number | undefined
  className?: string | undefined
  showPath?: boolean | undefined
  showFooter?: boolean | undefined
  showCopy?: boolean | undefined
  variant?: 'conversation' | 'review' | 'preview' | undefined
  labels?: Partial<DiffBlockLabels> | undefined
}

const DEFAULT_LABELS: DiffBlockLabels = {
  copy: '复制', copied: '复制成功',
  expand: count => `展开 ${count} 行`,
  collapse: '收起差异',
  expandContext: count => `展开 ${count} 行`,
  addedLine: (line, text) => `新增${line === null ? '' : `第 ${line} 行`}：${text}`,
  deletedLine: (line, text) => `删除${line === null ? '' : `第 ${line} 行`}：${text}`,
  contextLine: (line, text) => `未修改${line === null ? '' : `第 ${line} 行`}：${text}`,
}

interface FoldRow { kind: 'fold'; hidden: AlignedRow[]; key: string }
interface LimitFoldRow { kind: 'limit-fold'; hiddenCount: number }
type VisibleRow = AlignedRow | FoldRow | LimitFoldRow

function representedRowCount(row: VisibleRow): number {
  if (row.kind === 'fold') return row.hidden.length
  if (row.kind === 'limit-fold') return row.hiddenCount
  return 1
}

function foldedRows(rows: AlignedRow[], expanded: ReadonlySet<string>): VisibleRow[] {
  const output: VisibleRow[] = []
  let index = 0
  while (index < rows.length) {
    if (rows[index]?.kind !== 'context') { output.push(rows[index] as AlignedRow); index += 1; continue }
    const start = index
    while (rows[index]?.kind === 'context') index += 1
    const run = rows.slice(start, index)
    if (run.length < 15) { output.push(...run); continue }
    const key = `${start}:${run.length}`
    if (expanded.has(key)) { output.push(...run); continue }
    output.push(...run.slice(0, 3), { kind: 'fold', hidden: run.slice(3, -3), key }, ...run.slice(-3))
  }
  return output
}

function rowLineNumber(row: AlignedRow): number | null {
  return row.kind === 'del' ? row.oldLineNo : row.newLineNo
}

interface RenderSegment { text: string; style: HighlightSpan['style']; marked: boolean }

function renderSegments(text: string, syntax: readonly HighlightSpan[], marks: readonly TextRange[]): RenderSegment[] {
  const boundaries = new Set<number>([0, text.length])
  const syntaxRanges: Array<{ start: number; end: number; style: HighlightSpan['style'] }> = []
  let offset = 0
  for (const span of syntax) {
    const end = offset + span.text.length
    boundaries.add(offset); boundaries.add(end)
    syntaxRanges.push({ start: offset, end, style: span.style })
    offset = end
  }
  for (const mark of marks) { boundaries.add(mark.start); boundaries.add(mark.end) }
  const sorted = [...boundaries].filter(value => value >= 0 && value <= text.length).sort((a, b) => a - b)
  const result: RenderSegment[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]
    const end = sorted[index + 1]
    if (start === undefined || end === undefined || end <= start) continue
    result.push({
      text: text.slice(start, end),
      style: syntaxRanges.find(range => range.start <= start && range.end >= end)?.style ?? {},
      marked: marks.some(mark => mark.start < end && mark.end > start),
    })
  }
  return result
}

function copyText(diffs: readonly DiffHunk[]): string {
  return diffs.flatMap(diff => {
    const model = buildDiffHunkModel(diff)
    return [diff.path, ...model.rows.map(row => `${row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '} ${row.text}`)]
  }).join('\n')
}

function HunkCard({
  model, maxLines, showPath, labels,
}: {
  model: ReturnType<typeof buildDiffHunkModel>
  maxLines: number
  showPath: boolean
  labels: DiffBlockLabels
}) {
  const [expandedLimit, setExpandedLimit] = useState(false)
  const [expandedContext, setExpandedContext] = useState<ReadonlySet<string>>(new Set())
  const folded = foldedRows(model.rows, expandedContext)
  const capped = folded.length > maxLines && !expandedLimit
  const availableRows = Math.max(0, maxLines - 1)
  const head = Math.ceil(availableRows / 2)
  const tail = availableRows - head
  const hiddenRows = capped ? folded.slice(head, folded.length - tail) : []
  const hiddenCount = hiddenRows.reduce((total, row) => total + representedRowCount(row), 0)
  const visible: VisibleRow[] = capped
    ? [
        ...folded.slice(0, head),
        { kind: 'limit-fold', hiddenCount },
        ...(tail === 0 ? [] : folded.slice(-tail)),
      ]
    : folded

  const renderRow = (row: VisibleRow, index: number) => {
    if (row.kind === 'limit-fold') return (
      <button
        key="limit-fold"
        type="button"
        className={css.fold}
        aria-label={labels.expand(row.hiddenCount)}
        onClick={() => { setExpandedLimit(true) }}
      >
        {`⋯ ${labels.expand(row.hiddenCount)}`}
      </button>
    )
    if (row.kind === 'fold') return (
      <button
        key={row.key}
        type="button"
        className={css.fold}
        aria-label={labels.expandContext(row.hidden.length)}
        onClick={() => {
          setExpandedContext(current => new Set([...current, row.key]))
          setExpandedLimit(true)
        }}
      >
        {`⋯ ${labels.expandContext(row.hidden.length)}`}
      </button>
    )
    const number = rowLineNumber(row)
    const segments = renderSegments(row.text, row.syntax, row.marks)
    const accessibleLabel = row.kind === 'add'
      ? labels.addedLine(number, row.text)
      : row.kind === 'del'
        ? labels.deletedLine(number, row.text)
        : labels.contextLine(number, row.text)
    return (
      <div
        key={`${row.kind}:${number ?? 'x'}:${index}`}
        role="listitem"
        aria-label={accessibleLabel}
        className={clsx(css.line, css[row.kind])}
        data-diff-row={row.kind}
      >
        <span className={css.gutter} aria-hidden>{number ?? ''}</span>
        <span className={css.sign} aria-hidden>{row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ''}</span>
        <span className={css.content} aria-hidden>
          {segments.length === 0 ? row.text : segments.map((segment, segmentIndex) => (
            <span
              key={segmentIndex}
              data-code-token=""
              className={segment.marked ? (row.kind === 'add' ? css.wordAdd : css.wordDel) : undefined}
              style={segment.style}
            >
              {segment.text}
            </span>
          ))}
        </span>
      </div>
    )
  }

  return (
    <section className={css.hunk} data-diff-hunk="">
      {showPath && (
        <header className={css.path}>
          <span>{model.path}</span>
          <span className={css.counts}><b>{`+${model.added}`}</b><i>{`-${model.removed}`}</i></span>
        </header>
      )}
      <div className={css.rows} role="list" aria-label={model.path}>{visible.map(renderRow)}</div>
    </section>
  )
}

export function DiffBlock({
  diffs,
  maxLines = DEFAULT_DIFF_MAX_LINES,
  className,
  showPath = true,
  showFooter = true,
  variant = 'conversation',
  showCopy = variant !== 'preview',
  labels: labelOverrides,
}: DiffBlockProps) {
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  const models = useMemo(() => diffs.map(buildDiffHunkModel), [diffs, loaded])
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const [copied, setCopied] = useState(false)
  const total = models.reduce((sum, model) => ({ added: sum.added + model.added, removed: sum.removed + model.removed }), { added: 0, removed: 0 })
  const files = new Set(models.map(model => model.path)).size
  const onCopy = useCallback(() => {
    if (copied) return
    void writeClipboard(copyText(diffs)).then(ok => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [copied, diffs])
  if (diffs.length === 0) return null
  return (
    <div className={clsx(css.block, css[variant], className)} data-diff="" data-diff-block="">
      {showCopy && <button type="button" className={css.copyButton} onClick={onCopy}>{copied ? labels.copied : labels.copy}</button>}
      <div className={css.body}>
        {models.map((model, index) => <HunkCard key={`${model.path}:${model.oldStart ?? 'x'}:${model.newStart ?? 'x'}:${index}`} model={model} maxLines={maxLines} showPath={showPath} labels={labels} />)}
      </div>
      {showFooter && <div className={css.footer}>{`└ +${total.added} -${total.removed} · ${files} ${files === 1 ? 'file' : 'files'}`}</div>}
    </div>
  )
}
