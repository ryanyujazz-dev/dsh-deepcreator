// review-model: the Review panel's pure presentation model — parse-once diff
// layers with stable DiffBlock references, cache-keeping status merges,
// event-driven staleness marks, collapsed-cache LRU eviction, settled
// mutation-tool digests, and per-repository expansion persistence. No React,
// no Cordis: the panel wires these into component state.

import { parseUnifiedDiff, type DiffHunk } from '@ryanyujazz/dsh-client-ui-primitives'
import type { ConversationNode, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReviewDiffResult, ReviewFileStatus } from '@ryanyujazz/dsh-review/types'

/** Backward-compatible controller default; idle preheat is intentionally tiny. */
export const REVIEW_PREFETCH_LIMIT = 6

/** Diff bodies warmed while Review is visible before viewport demand takes over. */
export const REVIEW_IDLE_PREFETCH_LIMIT = 6

/** Non-resident ready caches kept beyond this count are evicted oldest-first. */
export const REVIEW_CACHE_LIMIT = 100

/** Approximate UTF-16/raw patch working-set budget for non-resident ready files. */
export const REVIEW_CACHE_BYTES = 32 * 1024 * 1024

/**
 * Formats that are consumed as artifacts rather than reviewed line-by-line.
 * `presentation: binary` remains the authoritative content signal; this
 * suffix list prevents a provisional status row from flashing before the
 * deferred presentation metadata arrives.
 *
 * Deliberately absent: generated text, lockfiles, snapshots, minified source,
 * notebooks and text data. Their provenance is not a reason to hide a
 * reviewable repository change.
 */
const NON_REVIEWABLE_FILE_EXTENSIONS = new Set([
  // Images and design documents (SVG is text-backed but belongs to preview).
  'ai', 'avif', 'bmp', 'cr2', 'fig', 'gif', 'heic', 'heif', 'ico', 'jpeg', 'jpg', 'png', 'psd', 'raw', 'sketch', 'svg', 'tif', 'tiff', 'webp',
  // Portable/Office documents.
  'doc', 'docx', 'pdf', 'ppt', 'pptx', 'xls', 'xlsx',
  // Audio and video.
  'avi', 'flac', 'm4a', 'mkv', 'mov', 'mp3', 'mp4', 'ogg', 'wav', 'webm',
  // Archives and packaged binaries.
  '7z', 'apk', 'bz2', 'dmg', 'gz', 'jar', 'rar', 'tar', 'xz', 'zip',
  // Fonts, compiled objects and executable modules.
  'a', 'bin', 'class', 'dll', 'dylib', 'eot', 'exe', 'o', 'otf', 'pyc', 'so', 'ttf', 'wasm', 'woff', 'woff2',
  // Embedded binary databases.
  'db', 'sqlite', 'sqlite3',
])

type ReviewPanelFileCandidate = Pick<ReviewFileStatus, 'path' | 'oldPath' | 'kind' | 'presentation'> & {
  binary?: boolean
}

function fileExtension(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot < 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Whether a repository fact belongs in the source Review surface.
 * Repositories, submodules and symlinks retain their Git semantics; ordinary
 * files must be text-reviewable and not a known artifact format.
 */
export function isReviewPanelFile(file: ReviewPanelFileCandidate): boolean {
  if (file.kind !== undefined && file.kind !== 'file') return true
  if (file.binary === true || file.presentation === 'binary') return false
  return ![file.path, file.oldPath].some(path => path !== undefined
    && NON_REVIEWABLE_FILE_EXTENSIONS.has(fileExtension(path)))
}

/** Normalize separators and drop a trailing slash so paths compare uniformly. */
function comparablePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '')
}

/**
 * Resolve a reveal target — an absolute workspace path or a cwd-relative Tool
 * argument — against the status list's repository-relative paths. Exact
 * identity (a rename's old path included) wins; otherwise either side may be
 * the deeper one, so accept either suffix and return the status-list path.
 */
export function matchReviewFile(files: readonly ReviewFileStatus[], target: string): string | undefined {
  const wanted = comparablePath(target)
  if (wanted === '') return undefined
  const exact = (path: string | undefined): boolean => path !== undefined && comparablePath(path) === wanted
  const suffix = (path: string | undefined): boolean => {
    if (path === undefined) return false
    const comparable = comparablePath(path)
    return comparable !== '' && (wanted.endsWith(`/${comparable}`) || comparable.endsWith(`/${wanted}`))
  }
  for (const file of files) {
    if (exact(file.path) || exact(file.oldPath)) return file.path
  }
  for (const file of files) {
    if (suffix(file.path) || suffix(file.oldPath)) return file.path
  }
  return undefined
}

/** One parse-time product of a layer: pre-merged hunks with source snapshots. */
export interface ParsedLayerFile {
  key: string
  binary: boolean
  hunks: readonly DiffHunk[]
}

export interface ParsedLayer {
  kind: 'staged' | 'working-tree' | 'uncommitted' | 'turn'
  files: readonly ParsedLayerFile[]
  added: number
  removed: number
}

export type ReadyCache = {
  kind: 'ready'
  layers: readonly ParsedLayer[]
  added: number
  removed: number
  /** The wire result the parse came from; identical revalidates reuse the parse. */
  raw: Extract<ReviewDiffResult, { ok: true }>
}

/** Approximate retained wire bytes; enough for deterministic weighted eviction. */
export function readyCacheBytes(cache: ReadyCache): number {
  let characters = cache.raw.path.length + (cache.raw.oldPath?.length ?? 0)
  for (const layer of cache.raw.layers) {
    characters += layer.patch.length + (layer.oldSource.text?.length ?? 0) + (layer.newSource.text?.length ?? 0)
  }
  return characters * 2
}

export type FileCache =
  | { kind: 'empty' }
  | { kind: 'loading' }
  | ReadyCache
  | { kind: 'error'; message: string }

/**
 * One file's presentation state. Staleness is event-driven — a status merge
 * marks an entry stale only when its git status fields actually moved, and a
 * settled mutation tool marks it explicitly; a plain refresh never does.
 */
export interface FileEntry {
  status: ReviewFileStatus
  cache: FileCache
  /** Ready cache probably outdated; cleared by the next completed fetch. */
  stale: boolean
  /** Monotonic stamp of the last expand; orders collapsed-cache eviction. */
  lastOpened: number
  /** A fetch (initial or revalidate) is in flight for this entry. */
  fetching: boolean
}

export type FileEntries = Record<string, FileEntry>

function statusEqual(a: ReviewFileStatus, b: ReviewFileStatus): boolean {
  return a.path === b.path && a.oldPath === b.oldPath && a.index === b.index && a.workingTree === b.workingTree
}

/** Parse one wire diff result once: hunks carry their snapshots, counts fold. */
export function parseDiffResult(diff: Extract<ReviewDiffResult, { ok: true }>): Omit<ReadyCache, 'kind' | 'raw'> {
  return assembleParsedDiff(diff, diff.layers.map(layer => parseUnifiedDiff(layer.patch, diff.path)))
}

type ParsedUnifiedLayers = ReturnType<typeof parseUnifiedDiff>[]

function assembleParsedDiff(
  diff: Extract<ReviewDiffResult, { ok: true }>,
  parsedLayers: ParsedUnifiedLayers,
): Omit<ReadyCache, 'kind' | 'raw'> {
  const layers: ParsedLayer[] = diff.layers.map((layer, layerIndex) => {
    const parsedFiles = parsedLayers[layerIndex] ?? []
    const files: ParsedLayerFile[] = parsedFiles.map(file => ({
      key: `${file.oldPath ?? ''}:${file.path}`,
      binary: file.binary,
      hunks: file.hunks.map(hunk => ({
        ...hunk,
        deferHighlight: true,
        oldSource: layer.oldSource.text,
        newSource: layer.newSource.text,
        oldLineCount: layer.oldSource.lineCount,
        newLineCount: layer.newSource.lineCount,
      })),
    }))
    return {
      kind: layer.kind,
      files,
      added: parsedFiles.reduce((sum, file) => sum + file.added, 0),
      removed: parsedFiles.reduce((sum, file) => sum + file.removed, 0),
    }
  })
  return {
    layers,
    added: layers.reduce((sum, layer) => sum + layer.added, 0),
    removed: layers.reduce((sum, layer) => sum + layer.removed, 0),
  }
}

/**
 * Self-contained parser copied into a Blob worker. Keeping this function free
 * of module references makes the worker usable from the bundled desktop
 * client without a second public asset or worker-specific build entry.
 */
function parseReviewDiffLayersInWorker(inputs: Array<{ patch: string; fallbackPath: string }>): ParsedUnifiedLayers {
  const headerPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u
  const stripPrefix = (value: string): string => {
    const path = value.slice(4).trim().split('\t', 1)[0] ?? ''
    if (path === '/dev/null') return path
    return path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path
  }
  return inputs.map(({ patch, fallbackPath }) => {
    const files: ParsedUnifiedLayers[number] = []
    let file: ParsedUnifiedLayers[number][number] | undefined
    const lines = patch.split('\n')
    let index = 0
    while (index < lines.length) {
      const line = lines[index] ?? ''
      if (line.startsWith('diff --git ')) {
        const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line)
        file = { oldPath: match?.[1] ?? null, path: match?.[2] ?? fallbackPath, binary: false, hunks: [], added: 0, removed: 0 }
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
      const header = headerPattern.exec(line)
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
  })
}

interface PendingWorkerParse {
  diff: Extract<ReviewDiffResult, { ok: true }>
  resolve: (value: Omit<ReadyCache, 'kind' | 'raw'>) => void
}

/** One controller-owned parser worker; tests and unsupported hosts fall back synchronously. */
export class ReviewDiffParser {
  private worker: Worker | null | undefined
  private workerUrl: string | null = null
  private serial = 0
  private disposed = false
  private readonly pending = new Map<number, PendingWorkerParse>()

  async parse(diff: Extract<ReviewDiffResult, { ok: true }>): Promise<Omit<ReadyCache, 'kind' | 'raw'>> {
    const worker = this.ensureWorker()
    if (worker === null || this.disposed) return parseDiffResult(diff)
    const id = ++this.serial
    return await new Promise(resolve => {
      this.pending.set(id, { diff, resolve })
      worker.postMessage({ id, layers: diff.layers.map(layer => ({ patch: layer.patch, fallbackPath: diff.path })) })
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disableWorker()
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== undefined) return this.worker
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined'
      || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      this.worker = null
      return null
    }
    try {
      const source = `const parseLayers = (${parseReviewDiffLayersInWorker.toString()});\nself.onmessage = event => {\n  const { id, layers } = event.data;\n  try { self.postMessage({ id, layers: parseLayers(layers) }); }\n  catch (reason) { self.postMessage({ id, error: reason instanceof Error ? reason.message : String(reason) }); }\n};`
      this.workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const worker = new Worker(this.workerUrl)
      worker.onmessage = (event: MessageEvent<{ id: number; layers?: ParsedUnifiedLayers; error?: string }>) => {
        const task = this.pending.get(event.data.id)
        if (task === undefined) return
        this.pending.delete(event.data.id)
        task.resolve(event.data.layers === undefined
          ? parseDiffResult(task.diff)
          : assembleParsedDiff(task.diff, event.data.layers))
      }
      worker.onerror = () => { this.disableWorker() }
      this.worker = worker
      return worker
    } catch {
      this.disableWorker()
      return null
    }
  }

  private disableWorker(): void {
    this.worker?.terminate()
    this.worker = null
    if (this.workerUrl !== null) URL.revokeObjectURL(this.workerUrl)
    this.workerUrl = null
    for (const task of this.pending.values()) task.resolve(parseDiffResult(task.diff))
    this.pending.clear()
  }
}

/** Wire-level identity of two diff results (SWR keep-parse reference test). */
export function sameDiffResult(a: Extract<ReviewDiffResult, { ok: true }>, b: Extract<ReviewDiffResult, { ok: true }>): boolean {
  if (a.path !== b.path || a.oldPath !== b.oldPath || a.kind !== b.kind || a.presentation !== b.presentation
    || a.lineStatsState !== b.lineStatsState || a.location?.repository !== b.location?.repository
    || a.layers.length !== b.layers.length) return false
  return a.layers.every((layer, index) => {
    const other = b.layers[index]
    return other !== undefined
      && layer.kind === other.kind
      && layer.patch === other.patch
      && layer.oldSource.text === other.oldSource.text
      && layer.oldSource.lineCount === other.oldSource.lineCount
      && layer.newSource.text === other.newSource.text
      && layer.newSource.lineCount === other.newSource.lineCount
  })
}

/**
 * Merge a fresh status list into the entry table. Kept files whose git status
 * fields are unchanged keep their entry object identity (rows and DiffBlock
 * memos survive untouched); a moved status carries the cache forward marked
 * stale. Files that left the list drop; new files start empty.
 */
export function mergeFileEntries(
  previous: Readonly<FileEntries>,
  files: readonly ReviewFileStatus[],
  nextStamp: () => number,
): FileEntries {
  const merged: FileEntries = {}
  for (const file of files) {
    const existing = previous[file.path]
    if (existing === undefined) {
      merged[file.path] = { status: file, cache: { kind: 'empty' }, stale: false, lastOpened: nextStamp(), fetching: false }
      continue
    }
    if (statusEqual(existing.status, file)) {
      merged[file.path] = existing
      continue
    }
    merged[file.path] = {
      status: file,
      cache: existing.cache,
      // A moved XY/rename means the underlying content probably moved too.
      stale: existing.stale || existing.cache.kind === 'ready',
      lastOpened: existing.lastOpened,
      fetching: existing.fetching,
    }
  }
  return merged
}

/**
 * Mark ready caches possibly outdated: every entry, or only the given paths.
 * Returns the same record reference when nothing matched so React state
 * updates bail out.
 */
export function markStale(entries: Readonly<FileEntries>, paths: ReadonlySet<string> | null): FileEntries {
  let changed = false
  const next: FileEntries = {}
  for (const [path, entry] of Object.entries(entries)) {
    if (entry.cache.kind === 'ready' && !entry.stale && (paths === null || paths.has(path))) {
      next[path] = { ...entry, stale: true }
      changed = true
    } else {
      next[path] = entry
    }
  }
  return changed ? next : entries as FileEntries
}

/**
 * Evict the oldest ready caches beyond the count or byte limit. Resident entries are exempt;
 * an in-flight fetch is never discarded. Returns null when nothing changed so
 * callers keep the previous record identity.
 */
export function evictCollapsedCaches(
  entries: Readonly<FileEntries>,
  residentPaths: ReadonlySet<string>,
  limit: number,
  byteLimit = REVIEW_CACHE_BYTES,
): FileEntries | null {
  const collapsed = Object.values(entries)
    .filter(entry => entry.cache.kind === 'ready' && !residentPaths.has(entry.status.path) && !entry.fetching)
    .sort((a, b) => a.lastOpened - b.lastOpened)
  let retainedBytes = Object.values(entries).reduce((sum, entry) => (
    sum + (entry.cache.kind === 'ready' ? readyCacheBytes(entry.cache) : 0)
  ), 0)
  let retainedCount = collapsed.length
  const evict = new Set<string>()
  for (const entry of collapsed) {
    if (retainedCount <= limit && retainedBytes <= byteLimit) break
    evict.add(entry.status.path)
    retainedCount -= 1
    retainedBytes -= readyCacheBytes(entry.cache as ReadyCache)
  }
  if (evict.size === 0) return null
  const next: FileEntries = {}
  for (const [path, entry] of Object.entries(entries)) {
    next[path] = evict.has(path)
      ? { ...entry, cache: { kind: 'empty' }, stale: false }
      : entry
  }
  return next
}

/** Tools whose settled results imply repository content may have moved. */
const MUTATION_TOOLS = new Set(['edit', 'write', 'bash'])

/** First file-looking argument of a mutation tool call, verbatim. */
export function mutationToolPath(argsRaw: string | undefined): string | null {
  if (argsRaw === undefined || argsRaw === '') return null
  try {
    const args = JSON.parse(argsRaw) as { file_path?: unknown; path?: unknown } | null
    const path = args?.file_path ?? args?.path
    return typeof path === 'string' && path !== '' ? path : null
  } catch {
    return null
  }
}

export interface MutationSignal {
  /** Settled mutation calls in the visible window (running calls excluded). */
  count: number
  lastSeq: number
  lastName: string
  /** Targeted path of the last settled edit/write; null for bash. */
  lastPath: string | null
}

const EMPTY_SIGNAL: MutationSignal = { count: 0, lastSeq: 0, lastName: '', lastPath: null }

/** Fold the snapshot's nodes into the compact settled-mutation signal. */
export function mutationSignal(nodes: readonly ConversationNode[]): MutationSignal {
  let count = 0
  let lastSeq = 0
  let lastName = ''
  let lastPath: string | null = null
  const visit = (block: ToolCallBlock | undefined): void => {
    if (block === undefined) return
    if ('kind' in block && block.kind === 'tool-result') {
      const name = block.call?.name ?? ''
      if (MUTATION_TOOLS.has(name)) {
        count += 1
        lastSeq = block.seq
        lastName = name
        lastPath = name === 'bash' ? null : mutationToolPath(block.call?.argsRaw)
      }
    }
    for (const child of block.subCalls) visit(child)
  }
  for (const node of nodes) {
    if (node.kind === 'tool-result') visit(node)
  }
  return count === 0 ? EMPTY_SIGNAL : { count, lastSeq, lastName, lastPath }
}

/** Primitive digest of the signal: a stable uSES selector return value. */
export function encodeMutationSignal(signal: MutationSignal): string {
  return [
    signal.count,
    signal.lastSeq,
    encodeURIComponent(signal.lastName),
    signal.lastPath === null ? '' : encodeURIComponent(signal.lastPath),
  ].join(' ')
}

export function decodeMutationSignal(digest: string): MutationSignal {
  const [count, lastSeq, lastName, lastPath] = digest.split(' ')
  const path = lastPath === undefined || lastPath === '' ? null : decodeURIComponent(lastPath)
  return {
    count: Number(count ?? 0) || 0,
    lastSeq: Number(lastSeq ?? 0) || 0,
    lastName: lastName === undefined ? '' : decodeURIComponent(lastName),
    lastPath: path,
  }
}
