import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { writeClipboard } from './clipboard.ts'
import { FileIcon } from './file-icons/FileIcon.tsx'
import {
  buildCachedDiffHunkModel, buildDiffHunkModel, diffContentLines, diffLanguageFromPath, prioritizeSnapshotHighlights,
  snapshotHighlightKey, subscribeSnapshotHighlight, type AlignedRow, type DiffHunkInput, type DiffHunkModel, type TextRange,
} from './diff/model.ts'
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
  /** Increment to re-fold every expanded fold row and the line cap (parent-driven reset). */
  foldResetSignal?: number | undefined
  /** Live count of this block's expanded folds (context folds, gaps, and the cap); host UI shows a re-fold control from it. */
  onFoldStateChange?: ((expandedFolds: number) => void) | undefined
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

interface ContextBasis {
  side: 'old' | 'new'
  source: string
  start: number
  consumed: number
}

interface OmittedContextGap {
  kind: 'gap'
  key: string
  path: string
  rows: AlignedRow[]
}

interface HunkEntry {
  kind: 'hunk'
  key: string
  model: DiffHunkModel
}

type ReviewEntry = OmittedContextGap | HunkEntry

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

function contextBasis(input: DiffHunk, model: DiffHunkModel): ContextBasis | undefined {
  if (input.newSource !== undefined && input.newSource !== null && input.newStart !== undefined && input.newStart > 0) {
    return {
      side: 'new', source: input.newSource, start: input.newStart,
      consumed: model.rows.filter(row => row.kind !== 'del').length,
    }
  }
  if (input.oldSource !== undefined && input.oldSource !== null && input.oldStart !== undefined && input.oldStart > 0) {
    return {
      side: 'old', source: input.oldSource, start: input.oldStart,
      consumed: model.rows.filter(row => row.kind !== 'add').length,
    }
  }
  return undefined
}

function omittedContextGap(
  path: string, basis: ContextBasis, start: number, count: number, position: string,
): OmittedContextGap | undefined {
  if (count <= 0 || start <= 0) return undefined
  const sourceLines = diffContentLines(basis.source)
  const lines = sourceLines.slice(start - 1, start - 1 + count)
  if (lines.length === 0) return undefined
  // The explicit terminator preserves a gap consisting solely of blank lines.
  const text = `${lines.join('\n')}\n`
  const rows = buildDiffHunkModel({
    path,
    oldText: text,
    newText: text,
    oldStart: start,
    newStart: start,
    oldSource: basis.source,
    newSource: basis.source,
  }).rows
  if (rows.length === 0) return undefined
  return { kind: 'gap', key: `${path}:${basis.side}:${start}:${rows.length}:${position}`, path, rows }
}

/** Reconstruct Git-omitted head, inter-hunk and tail context from Review snapshots. */
function reviewEntries(diffs: readonly DiffHunk[], models: readonly DiffHunkModel[]): ReviewEntry[] {
  const entries: ReviewEntry[] = []
  let previous: { path: string; basis: ContextBasis } | undefined

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index]
    const input = diffs[index]
    if (model === undefined || input === undefined) continue
    const basis = contextBasis(input, model)

    if (previous !== undefined && (previous.path !== model.path || basis === undefined || previous.basis.side !== basis.side || previous.basis.source !== basis.source)) {
      const tailStart = previous.basis.start + previous.basis.consumed
      const tail = omittedContextGap(
        previous.path,
        previous.basis,
        tailStart,
        diffContentLines(previous.basis.source).length - tailStart + 1,
        'tail',
      )
      if (tail !== undefined) entries.push(tail)
      previous = undefined
    }

    if (basis !== undefined) {
      if (previous === undefined) {
        const leading = omittedContextGap(model.path, basis, 1, basis.start - 1, 'head')
        if (leading !== undefined) entries.push(leading)
      } else {
        const gapStart = previous.basis.start + previous.basis.consumed
        const between = omittedContextGap(model.path, basis, gapStart, basis.start - gapStart, `before-${index}`)
        if (between !== undefined) entries.push(between)
      }
    }

    entries.push({ kind: 'hunk', key: `${model.path}:${model.oldStart ?? 'x'}:${model.newStart ?? 'x'}:${index}`, model })
    previous = basis === undefined ? undefined : { path: model.path, basis }
  }

  if (previous !== undefined) {
    const tailStart = previous.basis.start + previous.basis.consumed
    const tail = omittedContextGap(
      previous.path,
      previous.basis,
      tailStart,
      diffContentLines(previous.basis.source).length - tailStart + 1,
      'tail',
    )
    if (tail !== undefined) entries.push(tail)
  }
  return entries
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

function AlignedDiffRow({ row, index, labels }: { row: AlignedRow; index: number; labels: DiffBlockLabels }) {
  const number = rowLineNumber(row)
  const segments = renderSegments(row.text, row.syntax, row.marks)
  const accessibleLabel = row.kind === 'add'
    ? labels.addedLine(number, row.text)
    : row.kind === 'del'
      ? labels.deletedLine(number, row.text)
      : labels.contextLine(number, row.text)
  return (
    <div
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
            key={`${index}:${segmentIndex}`}
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

function OmittedContext({ gap, labels, resetSignal, onStateChange }: {
  gap: OmittedContextGap
  labels: DiffBlockLabels
  resetSignal: number
  onStateChange: (count: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const lastReset = useRef(resetSignal)
  useEffect(() => {
    if (resetSignal === lastReset.current) return
    lastReset.current = resetSignal
    setExpanded(false)
  }, [resetSignal])
  useEffect(() => { onStateChange(expanded ? 1 : 0) }, [expanded, onStateChange])
  if (!expanded) return (
    <button
      type="button"
      className={css.fold}
      aria-label={labels.expandContext(gap.rows.length)}
      onClick={() => { setExpanded(true) }}
    >
      {`⋯ ${labels.expandContext(gap.rows.length)}`}
    </button>
  )
  return (
    <div className={css.rows} role="list" aria-label={gap.path}>
      {gap.rows.map((row, index) => <AlignedDiffRow key={`${row.kind}:${rowLineNumber(row) ?? 'x'}:${index}`} row={row} index={index} labels={labels} />)}
    </div>
  )
}

function copyText(diffs: readonly DiffHunk[]): string {
  return diffs.flatMap(diff => {
    const model = buildDiffHunkModel(diff)
    return [diff.path, ...model.rows.map(row => `${row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '} ${row.text}`)]
  }).join('\n')
}

function HunkCard({
  model, maxLines, showPath, labels, resetSignal, onStateChange,
}: {
  model: ReturnType<typeof buildDiffHunkModel>
  maxLines: number
  showPath: boolean
  labels: DiffBlockLabels
  resetSignal: number
  onStateChange: (count: number) => void
}) {
  const [expandedLimit, setExpandedLimit] = useState(false)
  const [expandedContext, setExpandedContext] = useState<ReadonlySet<string>>(new Set())
  const lastReset = useRef(resetSignal)
  useEffect(() => {
    if (resetSignal === lastReset.current) return
    lastReset.current = resetSignal
    setExpandedLimit(false)
    setExpandedContext(new Set())
  }, [resetSignal])
  useEffect(() => {
    // A context-fold click also lifts the cap (one gesture); count it once.
    onStateChange(Math.max(expandedContext.size, expandedLimit ? 1 : 0))
  }, [expandedContext, expandedLimit, onStateChange])
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
    return <AlignedDiffRow key={`${row.kind}:${rowLineNumber(row) ?? 'x'}:${index}`} row={row} index={index} labels={labels} />
  }

  return (
    <section className={css.hunk} data-diff-hunk="">
      {showPath && (
        <header className={css.path}>
          <span className={css.pathLabel}><FileIcon path={model.path} /><span>{model.path}</span></span>
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
  foldResetSignal = 0,
  onFoldStateChange,
}: DiffBlockProps) {
  const loaded = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount)
  // Snapshots highlight progressively: a queued snapshot renders plain text,
  // the job jumps the queue on mount, and its completion bumps this tick so
  // the models rebuild with colors once — only for this block's snapshots.
  const snapshotKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const diff of diffs) {
      const language = diffLanguageFromPath(diff.path)
      if (diff.oldSource !== undefined && diff.oldSource !== null) keys.add(snapshotHighlightKey(diff.oldSource, language))
      if (diff.newSource !== undefined && diff.newSource !== null) keys.add(snapshotHighlightKey(diff.newSource, language))
    }
    return keys
  }, [diffs])
  const [snapshotTick, setSnapshotTick] = useState(0)
  useEffect(() => {
    prioritizeSnapshotHighlights(snapshotKeys)
    return subscribeSnapshotHighlight(() => { setSnapshotTick(tick => tick + 1) }, snapshotKeys)
  }, [snapshotKeys])
  const models = useMemo(() => diffs.map(buildCachedDiffHunkModel), [diffs, loaded, snapshotTick])
  const entries = useMemo<ReviewEntry[]>(() => variant === 'review'
    ? reviewEntries(diffs, models)
    : models.map((model, index) => ({
        kind: 'hunk', key: `${model.path}:${model.oldStart ?? 'x'}:${model.newStart ?? 'x'}:${index}`, model,
      })), [diffs, models, variant])
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }
  const [copied, setCopied] = useState(false)
  // Per-child fold counts, aggregated into one parent-visible number. Reporters
  // are stable per entry key so the children's report effects never re-fire on
  // identity; keys pruned when their entries leave the window.
  const foldCounts = useRef(new Map<string, number>())
  const foldReporters = useRef(new Map<string, (count: number) => void>())
  const reportTotal = useCallback(() => {
    if (onFoldStateChange === undefined) return
    let sum = 0
    for (const count of foldCounts.current.values()) sum += count
    onFoldStateChange(sum)
  }, [onFoldStateChange])
  const reporterFor = useCallback((key: string): (count: number) => void => {
    let reporter = foldReporters.current.get(key)
    if (reporter === undefined) {
      reporter = (count: number) => {
        foldCounts.current.set(key, count)
        reportTotal()
      }
      foldReporters.current.set(key, reporter)
    }
    return reporter
  }, [reportTotal])
  const liveKeys = new Set(entries.map(entry => entry.key))
  for (const key of foldCounts.current.keys()) {
    if (!liveKeys.has(key)) { foldCounts.current.delete(key); foldReporters.current.delete(key) }
  }
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
        {entries.map(entry => entry.kind === 'gap'
          ? <OmittedContext key={entry.key} gap={entry} labels={labels} resetSignal={foldResetSignal} onStateChange={reporterFor(entry.key)} />
          : <HunkCard key={entry.key} model={entry.model} maxLines={maxLines} showPath={showPath} labels={labels} resetSignal={foldResetSignal} onStateChange={reporterFor(entry.key)} />)}
      </div>
      {showFooter && <div className={css.footer}>{`└ +${total.added} -${total.removed} · ${files} ${files === 1 ? 'file' : 'files'}`}</div>}
    </div>
  )
}
