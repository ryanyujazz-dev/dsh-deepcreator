import { diffLines, diffWordsWithSpace } from 'diff'
import { highlightLines, type HighlightSpan } from '../markdown/highlight.ts'

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
export function buildDiffHunkModel(input: DiffHunkInput): DiffHunkModel {
  const oldText = input.oldText ?? ''
  const language = diffLanguageFromPath(input.path)
  const oldFull = input.oldSource !== undefined && input.oldSource !== null && input.oldSource.length <= FULL_SOURCE_HIGHLIGHT_LIMIT
    ? highlightLines(input.oldSource, language)
    : undefined
  const newFull = input.newSource !== undefined && input.newSource !== null && input.newSource.length <= FULL_SOURCE_HIGHLIGHT_LIMIT
    ? highlightLines(input.newSource, language)
    : undefined
  const oldSyntax = oldFull ?? highlightLines(oldText, language)
  const newSyntax = newFull ?? highlightLines(input.newText, language)
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
