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
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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

/** Resolve the install plan from version + source-fingerprint policy. */
export function resolvePlan(
  nextVersion: string,
  installed: { version: string; sourceFingerprint: string } | undefined,
  fingerprint: string,
): AppPublishPlan | { code: 'VERSION_NOT_BUMPED' } | { code: 'VERSION_DOWNGRADED' } {
  if (installed === undefined) return 'first'
  const c = compareVersions(nextVersion, installed.version)
  if (c === 0) return { code: 'VERSION_NOT_BUMPED' }
  if (c < 0) return { code: 'VERSION_DOWNGRADED' }
  return installed.sourceFingerprint === fingerprint ? 'update-same-source' : 'update-cross-source'
}

/** Recursively list snapshot files (bounded, sorted, forward slashes). */
export async function listSnapshotFiles(root: string): Promise<readonly string[]> {
  const out: string[] = []
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(join(root, rel), { withFileTypes: true })
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
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

/** Copy a dev source directory into a fresh staging directory (size-capped). */
export async function stageSnapshot(srcDir: string, stagingDir: string): Promise<{ files: readonly string[]; bytes: number } | { code: 'PACKAGE_TOO_LARGE'; files: readonly string[]; bytes: number }> {
  await mkdir(stagingDir, { recursive: true })
  await cp(srcDir, stagingDir, { recursive: true, verbatimSymlinks: false, force: true })
  const { files, bytes } = await hashSnapshot(stagingDir)
  if (bytes > PACKAGE_MAX_BYTES) {
    await rm(stagingDir, { recursive: true, force: true })
    return { code: 'PACKAGE_TOO_LARGE' as const, bytes, files }
  }
  return { files, bytes }
}

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
