// review-model: the Review panel's pure presentation model — parse-once diff
// layers with stable DiffBlock references, cache-keeping status merges,
// event-driven staleness marks, collapsed-cache LRU eviction, settled
// mutation-tool digests, and per-repository expansion persistence. No React,
// no Cordis: the panel wires these into component state.

import { parseUnifiedDiff, warmDiffHunkModels, type DiffHunk } from '@ryanyujazz/dsh-client-ui-primitives'
import type { ConversationNode, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReviewDiffResult, ReviewFileStatus } from '@ryanyujazz/dsh-review/types'

/** Files whose diffs the background prefetch warms per status, in order. */
export const REVIEW_PREFETCH_LIMIT = 50

/** Ready caches kept beyond this count are evicted oldest-first (safety valve). */
export const REVIEW_CACHE_LIMIT = 100

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
  kind: 'staged' | 'working-tree'
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
  const layers: ParsedLayer[] = diff.layers.map(layer => {
    const parsedFiles = parseUnifiedDiff(layer.patch, diff.path)
    const files: ParsedLayerFile[] = parsedFiles.map(file => ({
      key: `${file.oldPath ?? ''}:${file.path}`,
      binary: file.binary,
      hunks: file.hunks.map(hunk => ({
        ...hunk,
        oldSource: layer.oldSource.text,
        newSource: layer.newSource.text,
      })),
    }))
    return {
      kind: layer.kind,
      files,
      added: parsedFiles.reduce((sum, file) => sum + file.added, 0),
      removed: parsedFiles.reduce((sum, file) => sum + file.removed, 0),
    }
  })
  // Warm the row-alignment/syntax models now: the sequential prefetch queue
  // spreads this across awaits, so a later expand-all mounts DiffBlocks that
  // read memoized models instead of highlighting every file in one frame.
  warmDiffHunkModels(layers.flatMap(layer => layer.files.flatMap(file => file.hunks)))
  return {
    layers,
    added: layers.reduce((sum, layer) => sum + layer.added, 0),
    removed: layers.reduce((sum, layer) => sum + layer.removed, 0),
  }
}

/** Wire-level identity of two diff results (SWR keep-parse reference test). */
export function sameDiffResult(a: Extract<ReviewDiffResult, { ok: true }>, b: Extract<ReviewDiffResult, { ok: true }>): boolean {
  if (a.path !== b.path || a.oldPath !== b.oldPath || a.layers.length !== b.layers.length) return false
  return a.layers.every((layer, index) => {
    const other = b.layers[index]
    return other !== undefined
      && layer.kind === other.kind
      && layer.patch === other.patch
      && layer.oldSource.text === other.oldSource.text
      && layer.newSource.text === other.newSource.text
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
 * Evict the oldest ready caches beyond the limit. Expanded entries are exempt;
 * an in-flight fetch is never discarded. Returns null when nothing changed so
 * callers keep the previous record identity.
 */
export function evictCollapsedCaches(
  entries: Readonly<FileEntries>,
  expandedPaths: ReadonlySet<string>,
  limit: number,
): FileEntries | null {
  const collapsed = Object.values(entries)
    .filter(entry => entry.cache.kind === 'ready' && !expandedPaths.has(entry.status.path) && !entry.fetching)
    .sort((a, b) => a.lastOpened - b.lastOpened)
  if (collapsed.length <= limit) return null
  const evict = new Set(collapsed.slice(0, collapsed.length - limit).map(entry => entry.status.path))
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

/** Per-repository expansion memory caps: newest repositories and paths win. */
const EXPANSION_KEY = 'dsh.deepcreator.review.expansion.v1'
const EXPANSION_REPO_LIMIT = 10
const EXPANSION_PATH_LIMIT = 200

function readExpansionMap(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(EXPANSION_KEY)
    if (raw === null) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<string, string[]> = {}
    for (const [root, paths] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(paths)) continue
      const clean = paths.filter((path): path is string => typeof path === 'string')
      if (clean.length > 0) map[root] = clean
    }
    return map
  } catch {
    return {}
  }
}

/** Last persisted expansion for one repository, or null when none is stored. */
export function readExpandedPaths(repositoryRoot: string): ReadonlySet<string> | null {
  const stored = readExpansionMap()[repositoryRoot]
  return stored === undefined ? null : new Set(stored)
}

/** Persist one repository's expansion; trims oldest paths and other repos. */
export function writeExpandedPaths(repositoryRoot: string, paths: readonly string[]): void {
  if (paths.length === 0) return
  try {
    const map = readExpansionMap()
    delete map[repositoryRoot]
    map[repositoryRoot] = [...new Set(paths)].slice(-EXPANSION_PATH_LIMIT)
    const roots = Object.keys(map).slice(-EXPANSION_REPO_LIMIT)
    const trimmed: Record<string, string[]> = {}
    for (const root of roots) trimmed[root] = map[root] ?? []
    localStorage.setItem(EXPANSION_KEY, JSON.stringify(trimmed))
  } catch {
    // Storage quota or privacy mode: expansion memory is best-effort.
  }
}
