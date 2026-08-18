import { diffLines, diffWordsWithSpace } from 'diff'
import { grammarLoadCount, highlightLines, type HighlightSpan } from '../markdown/highlight.ts'

export interface TextRange { start: number; end: number }

export interface AlignedRow {
  kind: 'context' | 'add' | 'del'
  oldLineNo: number | null
  newLineNo: number | null
  text: string
  syntax: HighlightSpan[]
  marks: TextRange[]
}

export interface DiffHunkInput {
  path: string
  oldText: string | null
  newText: string
  oldStart?: number | undefined
  newStart?: number | undefined
  /** Optional full old snapshot used to preserve multiline grammar state. */
  oldSource?: string | null | undefined
  /** Optional full new snapshot used to preserve multiline grammar state. */
  newSource?: string | null | undefined
}

export interface DiffHunkModel {
  path: string
  oldStart?: number | undefined
  newStart?: number | undefined
  rows: AlignedRow[]
  added: number
  removed: number
}

const WORD_REFINEMENT_LIMIT = 4000
const FULL_SOURCE_HIGHLIGHT_LIMIT = 512 * 1024

/**
 * Full-snapshot highlighting memoized by source text and language. The Review
 * data plane attaches the same snapshot strings to every hunk of a file, so
 * the first hunk pays the tokenization and its siblings reuse the lines —
 * without this, N hunks re-tokenize each snapshot N times. Chat diffs build
 * hunks without snapshots, so they never enter this memo. Cleared when it
 * outgrows a generous working set (one file ≈ two snapshots) so an unexpected
 * burst of distinct sources cannot grow it unbounded.
 */
const snapshotHighlightMemo = new Map<string, Map<string, { version: number; lines: HighlightSpan[][] | undefined }>>()
const SNAPSHOT_HIGHLIGHT_MEMO_LIMIT = 256

/**
 * Snapshot highlighting is scheduled, not synchronous: a full-file
 * tokenization is an atomic long task, so background prefetch must not run it
 * inline (that is what froze the UI on workspace entry and expand-all). A
 * hunk whose snapshot is not highlighted yet builds with plain-text rows; the
 * job lands in a FIFO queue drained one snapshot at a time through idle
 * scheduling, and its completion bumps the model version so the owning
 * DiffBlocks rebuild with colors.
 */
interface SnapshotJob { key: string; lang: string; source: string }
const pendingSnapshots: SnapshotJob[] = []
const pendingSnapshotKeys = new Set<string>()
const snapshotSubscribers = new Set<{ keys: ReadonlySet<string>; fn: () => void }>()
/** Bumped per completed snapshot; folded into the hunk-model version. */
let snapshotEpoch = 0

/** Identity of one snapshot highlight: language plus the full source text. */
export function snapshotHighlightKey(source: string, language: string | undefined): string {
  return `${language ?? ''}\u0000${source}`
}

/**
 * Re-render when one of `keys` finishes highlighting. The listener fires only
 * for its own keys, so one file's highlight arrival re-renders only the
 * DiffBlocks that own it — never the whole panel.
 * @returns an unsubscribe function.
 */
export function subscribeSnapshotHighlight(listener: () => void, keys: ReadonlySet<string>): () => void {
  const entry = { keys, fn: listener }
  snapshotSubscribers.add(entry)
  return () => { snapshotSubscribers.delete(entry) }
}

/** Move the listed snapshots to the front of the queue: an expanded file
 *  colors in before background prefetch leftovers. */
export function prioritizeSnapshotHighlights(keys: ReadonlySet<string>): void {
  if (keys.size === 0) return
  const head: SnapshotJob[] = []
  const tail: SnapshotJob[] = []
  for (const job of pendingSnapshots) (keys.has(job.key) ? head : tail).push(job)
  pendingSnapshots.length = 0
  pendingSnapshots.push(...head, ...tail)
}

/** Idle scheduling; a timer fallback keeps tests and non-browser hosts deterministic. */
function scheduleIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => { task() }, { timeout: 2000 })
  } else {
    setTimeout(task, 0)
  }
}

function setSnapshotHighlight(source: string, lang: string, lines: HighlightSpan[][] | undefined): void {
  let byLang = snapshotHighlightMemo.get(source)
  if (byLang === undefined) {
    if (snapshotHighlightMemo.size >= SNAPSHOT_HIGHLIGHT_MEMO_LIMIT) snapshotHighlightMemo.clear()
    byLang = new Map()
    snapshotHighlightMemo.set(source, byLang)
  }
  byLang.set(lang, { version: grammarLoadCount(), lines })
}

/** One idle task per registration: each drain pass shifts a single job (or
 *  nothing), so a missed idle callback can never wedge the queue — a later
 *  registration simply schedules its own pass. */
function scheduleSnapshotHighlight(): void {
  scheduleIdle(drainSnapshotHighlights)
}

/** Highlight result for one snapshot, or undefined while it is queued. */
function highlightSnapshot(source: string, language: string | undefined): HighlightSpan[][] | undefined {
  if (source.length > FULL_SOURCE_HIGHLIGHT_LIMIT) return undefined
  const version = grammarLoadCount()
  const hit = snapshotHighlightMemo.get(source)?.get(language ?? '')
  if (hit !== undefined && hit.version === version) return hit.lines
  const key = snapshotHighlightKey(source, language)
  if (!pendingSnapshotKeys.has(key)) {
    pendingSnapshotKeys.add(key)
    pendingSnapshots.push({ key, lang: language ?? '', source })
    scheduleSnapshotHighlight()
  }
  return undefined
}

function drainSnapshotHighlights(): void {
  const job = pendingSnapshots.shift()
  if (job === undefined) return
  pendingSnapshotKeys.delete(job.key)
  setSnapshotHighlight(job.source, job.lang, highlightLines(job.source, job.lang))
  snapshotEpoch += 1
  for (const entry of snapshotSubscribers) {
    if (entry.keys.has(job.key)) entry.fn()
  }
}

/** A trailing newline terminates the last line; it does not create a phantom row. */
export function diffContentLines(value: string): string[] {
  if (value === '') return []
  const lines = value.split('\n')
  if (value.endsWith('\n')) lines.pop()
  return lines
}

/** Client-owned extension-to-Shiki mapping shared by chat and Review diffs. */
export function diffLanguageFromPath(path: string): string | undefined {
  const clean = path.split(/[?#]/u, 1)[0] ?? path
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase()
  const aliases: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
    json: 'json', jsonc: 'json', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
    java: 'java', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp',
    cs: 'csharp', kt: 'kotlin', swift: 'swift', php: 'php', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', ini: 'ini', md: 'markdown', mdx: 'mdx', html: 'html', htm: 'html',
    css: 'css', scss: 'scss', less: 'less', sql: 'sql', xml: 'xml', lua: 'lua',
    sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript',
  }
  return aliases[ext]
}

function wordMarks(oldText: string, newText: string): { oldMarks: TextRange[]; newMarks: TextRange[] } {
  if (oldText.length + newText.length > WORD_REFINEMENT_LIMIT) return { oldMarks: [], newMarks: [] }
  const oldMarks: TextRange[] = []
  const newMarks: TextRange[] = []
  let oldOffset = 0
  let newOffset = 0
  for (const part of diffWordsWithSpace(oldText, newText)) {
    if (part.removed === true) {
      if (part.value.length > 0) oldMarks.push({ start: oldOffset, end: oldOffset + part.value.length })
      oldOffset += part.value.length
      continue
    }
    if (part.added === true) {
      if (part.value.length > 0) newMarks.push({ start: newOffset, end: newOffset + part.value.length })
      newOffset += part.value.length
      continue
    }
    oldOffset += part.value.length
    newOffset += part.value.length
  }
  return { oldMarks, newMarks }
}

function refineReplacementRows(rows: AlignedRow[]): void {
  let cursor = 0
  while (cursor < rows.length) {
    if (rows[cursor]?.kind !== 'del') { cursor += 1; continue }
    const delStart = cursor
    while (rows[cursor]?.kind === 'del') cursor += 1
    const addStart = cursor
    while (rows[cursor]?.kind === 'add') cursor += 1
    const delCount = addStart - delStart
    const addCount = cursor - addStart
    const replacementLength = rows.slice(delStart, cursor).reduce((total, row) => total + row.text.length, 0)
    if (replacementLength > WORD_REFINEMENT_LIMIT) continue
    const pairs = Math.min(delCount, addCount)
    for (let index = 0; index < pairs; index += 1) {
      const deleted = rows[delStart + index]
      const added = rows[addStart + index]
      if (deleted === undefined || added === undefined) continue
      const marks = wordMarks(deleted.text, added.text)
      deleted.marks = marks.oldMarks
      added.marks = marks.newMarks
    }
  }
}

/** Build the renderer contract from one official or unified-diff hunk. */
const hunkModelCache = new WeakMap<DiffHunkInput, { version: string; model: DiffHunkModel }>()

/**
 * buildDiffHunkModel memoized by hunk-object identity and the grammar epoch
 * plus the snapshot-highlight epoch: the computation aligns rows AND
 * syntax-highlights the full source snapshots, so mounting many DiffBlocks in
 * one frame (Review expand-all) must not redo it. Stable hunk objects -
 * parsed once at fetch time by the Review data plane - hit the memo; callers
 * rebuilding hunks per render keep the direct cost. A snapshot highlight
 * arriving later bumps the epoch, so the queued plain-text model is rebuilt
 * with colors exactly once.
 */
export function buildCachedDiffHunkModel(input: DiffHunkInput): DiffHunkModel {
  const version = `${grammarLoadCount()}:${snapshotEpoch}`
  const hit = hunkModelCache.get(input)
  if (hit !== undefined && hit.version === version) return hit.model
  const model = buildDiffHunkModel(input)
  hunkModelCache.set(input, { version, model })
  return model
}

/** Warm the model memo for hunks whose DiffBlocks will mount later. */
export function warmDiffHunkModels(hunks: readonly DiffHunkInput[]): void {
  for (const hunk of hunks) buildCachedDiffHunkModel(hunk)
}

export function buildDiffHunkModel(input: DiffHunkInput): DiffHunkModel {
  const oldText = input.oldText ?? ''
  const language = diffLanguageFromPath(input.path)
  const oldOversize = input.oldSource !== undefined && input.oldSource !== null && input.oldSource.length > FULL_SOURCE_HIGHLIGHT_LIMIT
  const newOversize = input.newSource !== undefined && input.newSource !== null && input.newSource.length > FULL_SOURCE_HIGHLIGHT_LIMIT
  const oldFull = oldOversize || input.oldSource === undefined || input.oldSource === null
    ? undefined
    : highlightSnapshot(input.oldSource, language)
  const newFull = newOversize || input.newSource === undefined || input.newSource === null
    ? undefined
    : highlightSnapshot(input.newSource, language)
  // A queued snapshot renders plain text until its highlight lands; only
  // snapshot-less hunks (chat diffs) and oversized snapshots fall back to a
  // synchronous highlight of the hunk text itself.
  const oldSyntax = oldFull ?? (oldOversize || input.oldSource === undefined || input.oldSource === null
    ? highlightLines(oldText, language)
    : undefined)
  const newSyntax = newFull ?? (newOversize || input.newSource === undefined || input.newSource === null
    ? highlightLines(input.newText, language)
    : undefined)
  const rows: AlignedRow[] = []
  let oldIndex = 0
  let newIndex = 0
  let oldLine = input.oldStart
  let newLine = input.newStart
  let added = 0
  let removed = 0

  for (const part of diffLines(oldText, input.newText)) {
    const lines = diffContentLines(part.value)
    for (const text of lines) {
      if (part.removed === true) {
        rows.push({
          kind: 'del', oldLineNo: oldLine ?? null, newLineNo: null, text,
          syntax: oldFull?.[(oldLine ?? 1) - 1] ?? oldSyntax?.[oldIndex] ?? [], marks: [],
        })
        oldIndex += 1
        if (oldLine !== undefined) oldLine += 1
        removed += 1
      } else if (part.added === true) {
        rows.push({
          kind: 'add', oldLineNo: null, newLineNo: newLine ?? null, text,
          syntax: newFull?.[(newLine ?? 1) - 1] ?? newSyntax?.[newIndex] ?? [], marks: [],
        })
        newIndex += 1
        if (newLine !== undefined) newLine += 1
        added += 1
      } else {
        rows.push({
          kind: 'context', oldLineNo: oldLine ?? null, newLineNo: newLine ?? null, text,
          syntax: newFull?.[(newLine ?? 1) - 1] ?? newSyntax?.[newIndex]
            ?? oldFull?.[(oldLine ?? 1) - 1] ?? oldSyntax?.[oldIndex] ?? [], marks: [],
        })
        oldIndex += 1
        newIndex += 1
        if (oldLine !== undefined) oldLine += 1
        if (newLine !== undefined) newLine += 1
      }
    }
  }
  refineReplacementRows(rows)
  return {
    path: input.path,
    ...(input.oldStart === undefined ? {} : { oldStart: input.oldStart }),
    ...(input.newStart === undefined ? {} : { newStart: input.newStart }),
    rows,
    added,
    removed,
  }
}
