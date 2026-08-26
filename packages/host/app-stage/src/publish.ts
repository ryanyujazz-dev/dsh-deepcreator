/**
 * Publish-gate machinery (M3, Phase 1b): the machine-verified half of the
 * publish chain. Everything here is filesystem + pure functions — the
 * browser-backed staging probe lives in `probe.ts` and is composed in by the
 * service layer, so the gate itself stays unit-testable without a browser.
 *
 * Gate order (v0.0.5): locate → dev gate → version policy → snapshot (with
 * size cap) → zero-external scan → staging probe → (approval interleaves in
 * the agent tool) → commit into the install store.
 * @module @ryanyujazz/dsh-app-stage/publish
 */
import { createHash } from 'node:crypto'
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, stat, lstat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AppManifest, AppPublishPlan, AppPublishReport, AppScanViolation,
} from './types.ts'
import { validateManifestBytes } from './manifest.ts'
import { gateDevEntry } from './registry.ts'
import { installedPointerPath, installedVersionDir, readInstallPointer, storeRoot } from './store.ts'
import { workspaceToken } from './appdata.ts'

/** Whole-snapshot byte cap (`PACKAGE_TOO_LARGE`). */
export const PACKAGE_MAX_BYTES = 16 * 1024 * 1024
/** Snapshot violations reported before the gate refuses (`scan.violations` is advisory in the card, fatal past this). */
export const SCAN_VIOLATIONS_MAX = 64
/** Textual extensions the zero-external scanner reads. */
const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.xml', '.md'])
/** Navigation-API patterns that violate the sandbox's no-egress stance. */
const NAVIGATION_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /location\s*\.\s*assign\s*\(/, label: 'location.assign(' },
  { pattern: /location\s*\.\s*replace\s*\(/, label: 'location.replace(' },
  { pattern: /location\s*\.\s*href\s*=[^=]/, label: 'location.href =' },
  { pattern: /window\s*\.\s*open\s*\(/, label: 'window.open(' },
]
/** Absolute-URL pattern (the sandbox is self-contained: no egress at all). */
const ABSOLUTE_URL = /(?:https?:)?\/\/[^\s"'`)]{4,}/g

/**
 * Compare two dotted versions: >0 when `a` is newer, <0 older, 0 equal.
 * Non-numeric segments compare lexically after numeric ones run out.
 */
export function compareVersions(a: string, b: string): number {
  const as = a.split('.'), bs = b.split('.')
  const n = Math.max(as.length, bs.length)
  for (let i = 0; i < n; i++) {
    const av = as[i] ?? '', bv = bs[i] ?? ''
    const an = /^\d+$/.test(av) ? Number(av) : undefined
    const bn = /^\d+$/.test(bv) ? Number(bv) : undefined
    if (an !== undefined && bn !== undefined) {
      if (an !== bn) return an - bn
    } else {
      const c = av.localeCompare(bv)
      if (c !== 0) return c
    }
  }
  return 0
}

/**
 * Resolve the install plan from version + watermark + history policy (M6a v2).
 *
 * The **watermark** (`maxversion.json`, never trimmed by the history cap and
 * untouched by rollback) is the anti-rollback baseline: a version at or below
 * it that was already published needs explicit approval to ship again —
 * this is what makes "roll back then quietly republish the old number with
 * different code" impossible, while a genuine fix ABOVE the watermark still
 * flows normally (no self-lock; audit F1 vs safety#4 merged design).
 *
 * `history` maps version → digest for every remembered install (including
 * rollbacks): a same-number-different-digest republish is a hard approval
 * (supply-chain guard, audit safety#4); a same digest is idempotent.
 */
export function resolvePlan(
  nextVersion: string,
  installed: { version: string; sourceFingerprint: string } | undefined,
  fingerprint: string,
  watermark: { version: string; digest: string } | undefined,
  nextDigest: string,
  history: ReadonlyMap<string, string> = new Map(),
): AppPublishPlan | { code: 'VERSION_NOT_BUMPED' } | { code: 'VERSION_DOWNGRADED' } {
  if (installed === undefined) return 'first'
  const c = compareVersions(nextVersion, installed.version)
  if (c === 0) return { code: 'VERSION_NOT_BUMPED' }
  if (c < 0) return { code: 'VERSION_DOWNGRADED' }
  const top = watermark === undefined ? undefined : compareVersions(nextVersion, watermark.version)
  if (top !== undefined && top <= 0) {
    // At/below the watermark: an already-shipped number. Identical digest is
    // idempotent; anything else — including the same number with different
    // code — needs explicit approval.
    return history.get(nextVersion) === nextDigest ? 'update-same-source' : 'update-below-watermark'
    // (same-number-new-digest lands here too: it is below/at the watermark
    // with a digest history does not vouch for — same explicit approval.)
  }
  return installed.sourceFingerprint === fingerprint ? 'update-same-source' : 'update-cross-source'
}

/**
 * Snapshot exclusion rule (the design contract: hidden files, node_modules,
 * .git, and every symlink are never part of a package — a symlink is
 * recorded, never followed; copying one would materialize host files the
 * app author never shipped, and from an import source that is a real
 * exfiltration path).
 */
function isExcludedName(name: string): boolean {
  return name.startsWith('.') || name === 'node_modules'
}

/** Recursively list snapshot files (bounded, sorted, forward slashes). */
export async function listSnapshotFiles(root: string): Promise<readonly string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(root, rel), { withFileTypes: true })
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (isExcludedName(entry.name)) continue
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) await walk(child)
      else if (entry.isFile()) out.push(child)
    }
  }
  await walk('')
  return out
}

/** One file's scan findings (bounded snippets; positions are not reported). */
async function scanFile(root: string, file: string): Promise<readonly AppScanViolation[]> {
  if (!TEXT_EXTENSIONS.has(file.slice(file.lastIndexOf('.')).toLowerCase())) return []
  let text: string
  try { text = await readFile(join(root, file), 'utf8') } catch { return [] }
  const violations: AppScanViolation[] = []
  for (const match of text.matchAll(ABSOLUTE_URL)) {
    violations.push({ file, kind: 'absolute-url', snippet: match[0].slice(0, 120) })
  }
  for (const { pattern, label } of NAVIGATION_PATTERNS) {
    if (pattern.test(text)) violations.push({ file, kind: 'navigation-api', snippet: label })
  }
  return violations
}

/** The static zero-external scan over a snapshot directory. */
export async function scanZeroExternal(root: string): Promise<{ violations: readonly AppScanViolation[] }> {
  const files = await listSnapshotFiles(root)
  const all: AppScanViolation[] = []
  for (const file of files) {
    all.push(...await scanFile(root, file))
    if (all.length >= SCAN_VIOLATIONS_MAX) return { violations: all.slice(0, SCAN_VIOLATIONS_MAX) }
  }
  return { violations: all }
}

/** Content digest of a snapshot: file list + per-file sha256, joined. */
export async function hashSnapshot(root: string): Promise<{ digest: string; files: readonly string[]; bytes: number }> {
  const files = await listSnapshotFiles(root)
  const hash = createHash('sha256')
  let bytes = 0
  for (const file of files) {
    hash.update(file); hash.update('\0')
    const body = await readFile(join(root, file))
    bytes += body.byteLength
    hash.update(createHash('sha256').update(body).digest('hex')); hash.update('\0')
  }
  return { digest: hash.digest('hex'), files, bytes }
}

/**
 * Copy a source directory into a fresh staging directory through the same
 * whitelist walk the digest uses: hidden entries, node_modules, and .git
 * never enter; **symlinks are never followed and never copied** (their
 * target paths are reported instead — the design's "record, don't follow").
 * The byte cap accrues per file so an oversized tree is cut off mid-copy,
 * not after materializing it. A bare `cp` dereferences symlinks, which
 * would smuggle host files into the sandbox origin (audit F2/safety#1).
 */
export async function stageSnapshot(
  srcDir: string, stagingDir: string,
): Promise<{ files: readonly string[]; bytes: number; symlinked: readonly string[] } | { code: 'PACKAGE_TOO_LARGE'; files: readonly string[]; bytes: number }> {
  const symlinked: string[] = []
  let bytes = 0
  const files: string[] = []
  const copy = async (rel: string): Promise<void> => {
    const entries = await readdir(join(srcDir, rel), { withFileTypes: true })
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      if (isExcludedName(entry.name)) continue
      const child = rel === '' ? entry.name : `${rel}/${entry.name}`
      const from = join(srcDir, rel, entry.name)
      const to = join(stagingDir, rel, entry.name)
      if (entry.isSymbolicLink()) {
        symlinked.push(child)
        continue
      }
      if (entry.isDirectory()) {
        await mkdir(to, { recursive: true })
        await copy(child)
        continue
      }
      if (!entry.isFile()) continue
      bytes += (await stat(from)).size
      if (bytes > PACKAGE_MAX_BYTES) throw new PackageTooLargeError()
      await mkdir(dirname(to), { recursive: true })
      await copyFile(from, to)
      files.push(child)
    }
  }
  await mkdir(stagingDir, { recursive: true })
  try {
    await copy('')
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true })
    if (error instanceof PackageTooLargeError) return { code: 'PACKAGE_TOO_LARGE', files, bytes }
    throw error
  }
  // Defensive assertion: nothing symbolic ever survives into the staging.
  for (const file of files) {
    const probed = await lstat(join(stagingDir, file))
    if (probed.isSymbolicLink()) throw new Error(`staging integrity: ${file} became a symlink`)
  }
  return { files, bytes, symlinked }
}

/** Internal: aborts the whitelist copy the moment the cap is exceeded. */
class PackageTooLargeError extends Error {}


/** Persisted install pointer write (the store's single mutation primitive). */
export async function writeInstallPointer(
  appId: string, record: {
    version: string; digest: string; installedAt: string
    sourceWorkspace: string; sourceFingerprint: string; sourceSession: string; publishedVia: string
  }, home: string,
): Promise<void> {
  const dir = join(storeRoot(home), 'apps', 'installed', appId)
  await mkdir(dir, { recursive: true })
  await writeFile(installedPointerPath(appId, home), `${JSON.stringify({ appId, ...record }, null, 2)}\n`)
  await appendHistory(appId, { appId, ...record, at: record.installedAt }, home)
  await advanceWatermark(appId, record.version, record.digest, home)
}

/** History entries kept per app (`history.jsonl`, FIFO cap 50). */
export const HISTORY_CAP = 50

/** One history record: the pointer snapshot at install/rollback time. */
export interface AppHistoryRecord {
  readonly appId: string
  readonly version: string
  readonly digest: string
  readonly at: string
  readonly sourceWorkspace: string
  readonly sourceFingerprint: string
  readonly sourceSession: string
  readonly publishedVia: string
}

/** The rollback baseline (`maxversion.json`): highest version ever installed. */
export interface AppWatermark { readonly version: string; readonly digest: string; readonly at: string }

function historyPath(appId: string, home: string): string { return join(storeRoot(home), 'apps', 'installed', appId, 'history.jsonl') }
function watermarkPath(appId: string, home: string): string { return join(storeRoot(home), 'apps', 'installed', appId, 'maxversion.json') }

/** Read the install history (oldest first). A missing file reads empty. */
export async function readHistory(appId: string, home: string): Promise<readonly AppHistoryRecord[]> {
  try {
    const raw = await readFile(historyPath(appId, home), 'utf8')
    return raw.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as AppHistoryRecord)
  } catch { return [] }
}

/** Append one record, FIFO-capped. Rollbacks append with `publishedVia:'rollback'`. */
export async function appendHistory(appId: string, record: AppHistoryRecord, home: string): Promise<void> {
  const current = [...await readHistory(appId, home), record]
  const kept = current.slice(Math.max(0, current.length - HISTORY_CAP))
  const dir = join(storeRoot(home), 'apps', 'installed', appId)
  await mkdir(dir, { recursive: true })
  await writeFile(historyPath(appId, home), kept.map(item => JSON.stringify(item)).join('\n') + '\n')
}

/** Read only the persisted watermark file (no pointer fallback). */
async function readWatermarkFile(appId: string, home: string): Promise<AppWatermark | undefined> {
  try {
    const raw = JSON.parse(await readFile(watermarkPath(appId, home), 'utf8')) as Partial<AppWatermark>
    if (typeof raw.version === 'string' && typeof raw.digest === 'string') return { version: raw.version, digest: raw.digest, at: typeof raw.at === 'string' ? raw.at : '' }
  } catch { /* absent */ }
  return undefined
}

/**
 * Read the rollback baseline. Legacy installs (pre-M6a) have no file yet;
 * there the current pointer stands in until the next install materializes
 * the file — a pointer can never exceed a persisted watermark, so the
 * fallback only ever UNDERSTATES the baseline (safe side).
 */
export async function readWatermark(appId: string, home: string): Promise<AppWatermark | undefined> {
  const persisted = await readWatermarkFile(appId, home)
  if (persisted !== undefined) return persisted
  const pointer = await readInstallPointer(appId, home)
  return pointer === undefined ? undefined : { version: pointer.version, digest: pointer.digest, at: pointer.installedAt }
}

/**
 * Advance the watermark; only a strictly higher version moves it. Compares
 * against the FILE alone — the pointer was just written to the same version,
 * so a pointer fallback here would always compare equal and never persist
 * anything (found by the M6b rollback test: the watermark silently degraded
 * to "read the pointer", which rollback then moved).
 */
export async function advanceWatermark(appId: string, version: string, digest: string, home: string): Promise<void> {
  const current = await readWatermarkFile(appId, home)
  if (current !== undefined && compareVersions(version, current.version) <= 0) return
  const dir = join(storeRoot(home), 'apps', 'installed', appId)
  await mkdir(dir, { recursive: true })
  await writeFile(watermarkPath(appId, home), `${JSON.stringify({ version, digest, at: new Date().toISOString() }, null, 2)}\n`)
}

/**
 * Per-app mutation serialization (audit H1): pointer writes from a publish
 * commit and a rollback must not interleave. Single host process; a promise
 * chain per app is the whole lock.
 */
const installMutex = new Map<string, Promise<unknown>>()

/** Run an install-store mutation under the app's serialization chain. */
export function withInstallLock<T>(appId: string, run: () => Promise<T>): Promise<T> {
  const prior = installMutex.get(appId) ?? Promise.resolve()
  const next = prior.then(run, run)
  installMutex.set(appId, next.then(() => undefined, () => undefined))
  return next
}

/**
 * Roll the current pointer back to an already-installed version (M6b).
 * Safety: the target version directory must exist AND its recomputed digest
 * must match the history record (audit safety#3 — without this, the
 * 'rollback to the already-approved v2' combo could serve freshly swapped
 * code as v2). Data/journal/assets stay untouched (code-only switch);
 * the watermark never moves (that is its entire purpose).
 */
export async function rollbackInstalled(
  appId: string, version: string, home: string, source: { workspace: string; session: string },
): Promise<{ ok: true; record: AppHistoryRecord } | { ok: false; code: 'ROLLBACK_TARGET_MISSING' | 'ROLLBACK_DIGEST_MISMATCH' | 'APP_NOT_INSTALLED'; message: string }> {
  return withInstallLock(appId, async () => {
    const pointer = await readInstallPointer(appId, home)
    if (pointer === undefined) return { ok: false, code: 'APP_NOT_INSTALLED', message: `"${appId}" is not installed.` }
    const history = await readHistory(appId, home)
    const record = [...history].reverse().find(item => item.version === version)
    const dir = installedVersionDir(appId, version, home)
    let exists = true
    try { await stat(dir) } catch { exists = false }
    if (record === undefined || !exists) {
      return { ok: false, code: 'ROLLBACK_TARGET_MISSING', message: `Version ${version} is not available to roll back to (no history entry or the version directory is gone).` }
    }
    const { digest } = await hashSnapshot(dir)
    if (digest !== record.digest) {
      return { ok: false, code: 'ROLLBACK_DIGEST_MISMATCH', message: `Version ${version} directory content no longer matches its recorded digest — the store is corrupted; reinstall the app.` }
    }
    const next: AppHistoryRecord = {
      appId, version, digest, at: new Date().toISOString(),
      sourceWorkspace: source.workspace, sourceFingerprint: pointer.sourceFingerprint,
      sourceSession: source.session, publishedVia: 'rollback',
    }
    await writeInstallPointer(appId, {
      version, digest, installedAt: next.at,
      sourceWorkspace: pointer.sourceWorkspace, sourceFingerprint: pointer.sourceFingerprint,
      sourceSession: pointer.sourceSession, publishedVia: 'rollback',
    }, home)
    return { ok: true, record: next }
  })
}

/** Move a staged snapshot into the install store under its version. */
export async function commitSnapshot(stagingDir: string, appId: string, version: string, home: string): Promise<void> {
  const target = installedVersionDir(appId, version, home)
  await rm(target, { recursive: true, force: true })
  await mkdir(join(storeRoot(home), 'apps', 'installed', appId), { recursive: true })
  try {
    await rename(stagingDir, target)
  } catch {
    // Cross-device fallback: copy then drop the staging tree.
    await cp(stagingDir, target, { recursive: true })
    await rm(stagingDir, { recursive: true, force: true })
  }
}

/** Remove one installed app completely: snapshots, pointer, assets, AppData. */
export async function uninstallApp(
  appId: string, home: string,
): Promise<{ removed: readonly string[] } | { code: 'APP_NOT_INSTALLED' | 'STORE_WRITE_FAILED'; message: string }> {
  const root = join(storeRoot(home), 'apps', 'installed', appId)
  const pointer = await readInstallPointer(appId, home)
  if (pointer === undefined) {
    try { await readdir(root) } catch { return { code: 'APP_NOT_INSTALLED', message: `"${appId}" is not installed.` } }
  }
  const removed: string[] = []
  try {
    for (const dir of [root, join(storeRoot(home), 'apps', 'assets', appId), join(storeRoot(home), 'apps', 'data', appId)]) {
      await rm(dir, { recursive: true, force: true })
      removed.push(dir)
    }
    return { removed }
  } catch (error) {
    return { code: 'STORE_WRITE_FAILED', message: `uninstall failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Assemble the shared publish report from staged facts. */
export async function buildReport(stagingDir: string, manifest: AppManifest, probe: AppPublishReport['probe']): Promise<AppPublishReport> {
  const { digest, files, bytes } = await hashSnapshot(stagingDir)
  const scan = await scanZeroExternal(stagingDir)
  return {
    appId: manifest.id, name: manifest.name, version: manifest.version,
    fileCount: files.length, totalBytes: bytes, digest,
    scan, probe,
  }
}

/** Re-validate a staged manifest straight off the staging directory. */
export async function readStagedManifest(stagingDir: string, appId: string): Promise<AppManifest | undefined> {
  try {
    const bytes = await readFile(join(stagingDir, 'app.json'))
    const validated = validateManifestBytes(appId, bytes)
    return validated.ok ? validated.manifest : undefined
  } catch { return undefined }
}

/** The dev-gate half reused by publish: locate + gate one workspace app. */
export async function gateForPublish(
  cwd: string, appId: string, conflictsWithInstalled: boolean,
): Promise<{ code: 'APP_NOT_FOUND' | 'DEV_GATE_FAILED'; message: string } | { manifest: AppManifest; dir: string }> {
  const dir = join(cwd, '.deepcreator', 'apps', appId)
  try { await readdir(dir) } catch { return { code: 'APP_NOT_FOUND', message: `No app directory ".deepcreator/apps/${appId}" in this workspace.` } }
  const entry = await gateDevEntry(dir, appId, conflictsWithInstalled)
  if (entry.status !== 'ready' || entry.manifest === undefined) {
    return { code: 'DEV_GATE_FAILED', message: `${entry.reason?.code ?? 'gate.incomplete'}: ${entry.reason?.detail ?? 'dev entry is not ready'}` }
  }
  return { manifest: entry.manifest, dir }
}

/** Stable per-workspace publish fingerprint (same spelling as the dev data token). */
export function publishFingerprint(cwd: string): string { return workspaceToken(cwd) }
