/**
 * AppData — the per-app logical document (one object tree) with key-path
 * reads/writes and an append-only journal, dual-domain (installed = global
 * appId; dev = workspace + appId, keyed host-side by an opaque workspace
 * token so agent file tools can never bypass the journal).
 *
 * Filesystem is the only source of truth: `doc.json` carries the envelope
 * (schemaVersion from manifest dataVersion, monotonic rev, the data tree);
 * `journal.jsonl` appends one {path, value, causeId, ts, rev} line per set —
 * undo/export/recovery are journal replay for free. Limits are explicit
 * constants (single value 256 KiB, document 4 MiB); a journal past its keep
 * window is compacted to the most recent entries on append.
 * @module @ryanyujazz/dsh-app-stage/appdata
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './store.ts'

/** A single value must not exceed 256 KiB (structured data; binaries belong to the asset channel). */
export const VALUE_MAX_BYTES = 256 * 1024
/** One app's whole document must not exceed 4 MiB. */
export const DOC_MAX_BYTES = 4 * 1024 * 1024
/** Journal compaction watermark: keep at most this many trailing entries. */
export const JOURNAL_KEEP = 1000
/** One changes pull returns at most this many entries; older history is journal-file territory. */
export const CHANGES_MAX = 200

/** The stored document envelope: schemaVersion rides with the data (Phase 3 migration ground). */
export interface AppDataDoc {
  readonly schemaVersion: string
  readonly rev: number
  readonly data: Record<string, unknown>
}

/** One journal line — a single applied key-path write. */
export interface AppDataJournalEntry {
  readonly rev: number
  readonly path: string
  readonly value: unknown
  readonly causeId: string
  readonly ts: string
}

/** Which domain a data operation addresses. */
export type AppDataScope = 'installed' | 'dev'

/** Key-path grammar shared with manifest persist declarations. */
const KEY_PATH = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/

/**
 * Opaque workspace token for the dev domain (same derivation as the static
 * serve tokens): the URL/storage face never exposes workspace paths.
 * @param cwd - workspace root path.
 * @returns first 24 hex chars of sha256(cwd).
 */
export function workspaceToken(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 24)
}

/**
 * Domain-scoped storage root for one app.
 * @param scope - installed (global) or dev (workspace-keyed).
 * @param appId - the app's id.
 * @param cwd - workspace root (dev scope only).
 * @param home - DSH home override (tests).
 * @returns the directory holding doc.json + journal.jsonl.
 */
export function appDataDir(scope: AppDataScope, appId: string, cwd: string | undefined, home: string = dshHome()): string {
  if (scope === 'installed') return join(home, 'deepcreator', 'apps', 'data', appId)
  if (cwd === undefined) throw new Error('appdata: dev scope requires a workspace binding.')
  return join(home, 'deepcreator', 'apps', 'data', 'dev', workspaceToken(cwd), appId)
}

function parseJournal(text: string): AppDataJournalEntry[] {
  const out: AppDataJournalEntry[] = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      out.push(JSON.parse(line) as AppDataJournalEntry)
    } catch {
      // A torn final line (crash mid-append) is skipped: the doc is truth.
    }
  }
  return out
}

async function readDoc(dir: string, schemaVersion: string): Promise<AppDataDoc> {
  let raw: string
  try {
    raw = await readFile(join(dir, 'doc.json'), 'utf8')
  } catch {
    return { schemaVersion, rev: 0, data: {} }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AppDataDoc>
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.data !== 'object' || parsed.data === null || typeof parsed.rev !== 'number') {
      return { schemaVersion, rev: 0, data: {} }
    }
    return { schemaVersion: typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : schemaVersion, rev: parsed.rev, data: parsed.data }
  } catch {
    // Unreadable/corrupt doc: keep storage but serve an empty tree — journal replay is the recovery path.
    return { schemaVersion, rev: 0, data: {} }
  }
}

/** Navigate a dot path inside the tree; returns undefined when any segment is missing or not an object. */
export function getPath(tree: Record<string, unknown>, path: string): unknown {
  let current: unknown = tree
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Set a dot path, creating intermediate objects; returns the mutated tree (in place). */
function setPath(tree: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  let current: Record<string, unknown> = tree
  for (const segment of segments.slice(0, -1)) {
    const next = current[segment]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
      continue
    }
    current = next as Record<string, unknown>
  }
  current[segments[segments.length - 1]!] = value
}

async function writeAtomic(file: string, body: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, body, 'utf8')
  await rename(tmp, file)
}

/**
 * Read the document (whole tree, or one key path).
 * @returns the value and the current revision.
 */
export async function appDataGet(
  scope: AppDataScope, appId: string, path: string | undefined, cwd: string | undefined,
  schemaVersion = '1', home?: string,
): Promise<{ value: unknown; rev: number }> {
  const dir = appDataDir(scope, appId, cwd, home)
  const doc = await readDoc(dir, schemaVersion)
  return { value: path === undefined ? doc.data : getPath(doc.data, path), rev: doc.rev }
}

/**
 * Apply one key-path write: validate limits, mutate the tree, persist the
 * doc atomically, and append the journal line. The write is the unit of
 * truth; the journal is its history.
 * @throws {Error} with a machine code suffix when limits or the path are violated.
 */
export async function appDataSet(
  scope: AppDataScope, appId: string, path: string, value: unknown, causeId: string,
  cwd: string | undefined, schemaVersion = '1', home?: string,
): Promise<{ rev: number }> {
  if (!KEY_PATH.test(path)) throw new Error(`PATH_INVALID: "${path}" is not a legal key path (dot-separated lowerCamel segments).`)
  const encoded = JSON.stringify(value ?? null)
  if (Buffer.byteLength(encoded) > VALUE_MAX_BYTES) {
    throw new Error(`VALUE_TOO_LARGE: single values are capped at ${VALUE_MAX_BYTES} bytes; store binaries as asset references.`)
  }
  const dir = appDataDir(scope, appId, cwd, home)
  const doc = await readDoc(dir, schemaVersion)
  const next: Record<string, unknown> = structuredClone(doc.data)
  setPath(next, path, JSON.parse(encoded) as unknown)
  const nextBody = JSON.stringify({ schemaVersion: doc.schemaVersion, rev: doc.rev + 1, data: next })
  if (Buffer.byteLength(nextBody) > DOC_MAX_BYTES) {
    throw new Error(`DOC_TOO_LARGE: the app document is capped at ${DOC_MAX_BYTES} bytes.`)
  }
  const entry: AppDataJournalEntry = { rev: doc.rev + 1, path, value: JSON.parse(encoded) as unknown, causeId, ts: new Date().toISOString() }
  await writeAtomic(join(dir, 'doc.json'), nextBody)
  let journal = parseJournal(await readFile(join(dir, 'journal.jsonl'), 'utf8').catch(() => ''))
  journal.push(entry)
  if (journal.length > JOURNAL_KEEP * 2) journal = journal.slice(-JOURNAL_KEEP)
  await writeAtomic(join(dir, 'journal.jsonl'), `${journal.map(line => JSON.stringify(line)).join('\n')}\n`)
  return { rev: entry.rev }
}

/**
 * Journal entries after a revision (subscribe polling face, newest last).
 * @returns at most {@link CHANGES_MAX} entries with rev > sinceRev.
 */
export async function appDataChanges(
  scope: AppDataScope, appId: string, sinceRev: number, cwd: string | undefined,
  home?: string,
): Promise<readonly AppDataJournalEntry[]> {
  const dir = appDataDir(scope, appId, cwd, home)
  const journal = parseJournal(await readFile(join(dir, 'journal.jsonl'), 'utf8').catch(() => ''))
  return journal.filter(entry => entry.rev > sinceRev).slice(-CHANGES_MAX)
}

/**
 * Remove an app's whole AppData domain (uninstall path, M3).
 * @returns completion; a missing directory is already clean.
 */
export async function appDataDrop(scope: AppDataScope, appId: string, cwd: string | undefined, home?: string): Promise<void> {
  await rm(appDataDir(scope, appId, cwd, home), { recursive: true, force: true })
}
