import type { DiffHunkInput } from './model.ts'

export interface UnifiedDiffFile {
  oldPath: string | null
  path: string
  binary: boolean
  hunks: DiffHunkInput[]
  added: number
  removed: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

function stripPrefix(value: string): string {
  const path = value.slice(4).trim().split('\t', 1)[0] ?? ''
  if (path === '/dev/null') return path
  return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path
}

/** Parse Git unified output into contextual old/new hunk inputs. */
export function parseUnifiedDiff(patch: string, fallbackPath = ''): UnifiedDiffFile[] {
  const files: UnifiedDiffFile[] = []
  let file: UnifiedDiffFile | undefined
  const lines = patch.split('\n')
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line)
      file = {
        oldPath: match?.[1] ?? null,
        path: match?.[2] ?? fallbackPath,
        binary: false,
        hunks: [],
        added: 0,
        removed: 0,
      }
      files.push(file)
      index += 1
      continue
    }
    if (file === undefined && line.startsWith('@@ ')) {
      file = { oldPath: fallbackPath || null, path: fallbackPath, binary: false, hunks: [], added: 0, removed: 0 }
      files.push(file)
    }
    if (file !== undefined && line.startsWith('--- ')) {
      const oldPath = stripPrefix(line)
      file.oldPath = oldPath === '/dev/null' ? null : oldPath
      index += 1
      continue
    }
    if (file !== undefined && line.startsWith('+++ ')) {
      const path = stripPrefix(line)
      if (path !== '/dev/null') file.path = path
      index += 1
      continue
    }
    if (file !== undefined && (/^(?:Binary files |GIT binary patch)/u).test(line)) {
      file.binary = true
      index += 1
      continue
    }
    const header = HUNK_HEADER.exec(line)
    if (file === undefined || header === null) { index += 1; continue }
    const oldLines: string[] = []
    const newLines: string[] = []
    let added = 0
    let removed = 0
    index += 1
    while (index < lines.length) {
      const hunkLine = lines[index] ?? ''
      if (hunkLine.startsWith('diff --git ') || hunkLine.startsWith('@@ ')) break
      if (hunkLine.startsWith('\\ No newline at end of file')) { index += 1; continue }
      if (hunkLine.startsWith('-')) { oldLines.push(hunkLine.slice(1)); removed += 1 }
      else if (hunkLine.startsWith('+')) { newLines.push(hunkLine.slice(1)); added += 1 }
      else if (hunkLine.startsWith(' ')) { oldLines.push(hunkLine.slice(1)); newLines.push(hunkLine.slice(1)) }
      else break
      index += 1
    }
    file.hunks.push({
      path: file.path,
      oldText: oldLines.length === 0 ? null : oldLines.join('\n'),
      newText: newLines.join('\n'),
      oldStart: Number(header[1]),
      newStart: Number(header[2]),
    })
    file.added += added
    file.removed += removed
  }
  return files
}
