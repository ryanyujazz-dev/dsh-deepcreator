/**
 * The runtime asset channel (M4, D15): agent-side binary delivery into an
 * installed app's own runtime asset directory — the AppData channel's
 * binary sibling. Assets live under `$DSH_HOME/deepcreator/apps/assets/
 * <appId>/` (separated from version snapshots, wiped by uninstall, never
 * inside a publish), are served same-origin from the stage's assets route
 * (CSP 'self' holds), and only passive media pass: png/jpg/webp/gif/mp4/
 * webm, extension AND magic-byte verified, content-type from the whitelist,
 * never text/html. No SVG — the script vector, same rule as icons.
 *
 * The writer is the agent (a preset tool, fully audited in the session
 * log); the app can only GET its own assets passively — no DeepCreator
 * capability crosses this boundary (零能力拍板, D15). No delete tool in v1:
 * reclamation is same-name overwrite or uninstall; quota is the guardrail.
 * @module @ryanyujazz/dsh-app-stage/assets
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

/** Legal asset names: filename chars only, ≤128, extension in the whitelist. */
export const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Per-asset size ceiling (B9). */
export const ASSET_MAX_BYTES = 64 * 1024 * 1024

/** Per-app quota ceiling (B9). */
export const ASSET_QUOTA_BYTES = 256 * 1024 * 1024

/** The passive-media whitelist: extension → content type (no SVG, ever). */
export const ASSET_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

/** The assets route prefix (served by serve.ts, same origin as the app). */
export const ASSETS_ROUTE = '/deepcreator-app-stage/assets'

/** One listed asset (B10 wire shape). */
export interface AssetEntry {
  readonly name: string
  readonly url: string
  readonly mediaType: string
  readonly bytes: number
  readonly updatedAt: string
}

/** The write result (B9 wire shape). */
export interface AssetWriteResult {
  readonly ok: true
  readonly appId: string
  readonly name: string
  readonly url: string
  readonly mediaType: string
  readonly bytes: number
  readonly overwritten: boolean
  readonly quotaUsedBytes: number
}

/** Failure vocabulary (deterministic eight, B9). */
export type AssetWriteFailure =
  | 'SOURCE_PATH_INVALID'
  | 'SOURCE_NOT_FOUND'
  | 'NAME_INVALID'
  | 'MIME_UNSUPPORTED'
  | 'ASSET_TOO_LARGE'
  | 'ASSET_QUOTA_EXCEEDED'
  | 'STORE_WRITE_FAILED'

/** The assets root of one installed app. */
export function assetsDir(home: string, appId: string): string {
  return join(home, 'deepcreator', 'apps', 'assets', appId)
}

/** The served URL of one asset (version-independent, uninstall-wiped). */
export function assetUrl(appId: string, name: string): string {
  return `${ASSETS_ROUTE}/${appId}/${name}`
}

/** Sniff magic bytes against the declared extension's family. */
function sniffMatches(mediaType: string, head: Buffer): boolean {
  if (mediaType === 'image/png') return head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  if (mediaType === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  if (mediaType === 'image/gif') return head.length >= 6 && head.subarray(0, 3).toString('latin1') === 'GIF'
  if (mediaType === 'image/webp') return head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP'
  if (mediaType === 'video/mp4') return head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp'
  if (mediaType === 'video/webm') return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
  return false
}

/** Total bytes an app's asset directory holds (quota accounting). */
async function quotaUsed(dir: string): Promise<number> {
  try {
    const names = await readdir(dir)
    let total = 0
    for (const name of names) {
      const info = await stat(join(dir, name))
      if (info.isFile()) total += info.size
    }
    return total
  } catch {
    return 0
  }
}

/**
 * Copy one workspace file into the app's asset directory (idempotent
 * upsert by name). The source must resolve inside the workspace root —
 * absolute paths and escapes are rejected (the create_image input_paths
 * precedent).
 */
export async function writeAsset(
  home: string, appId: string, name: string, sourcePath: string, workspaceRoot: string,
): Promise<{ ok: true; result: AssetWriteResult } | { ok: false; code: AssetWriteFailure; message: string }> {
  if (!ASSET_NAME_PATTERN.test(name) || name.length > 128) {
    return { ok: false, code: 'NAME_INVALID', message: `asset name "${name}" must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (≤128 chars).` }
  }
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  const mediaType = ASSET_MEDIA_TYPES[ext]
  if (mediaType === undefined) {
    return { ok: false, code: 'MIME_UNSUPPORTED', message: `extension ".${ext}" is not in the passive-media whitelist (${Object.keys(ASSET_MEDIA_TYPES).join(', ')}).` }
  }
  if (sourcePath === '' || sourcePath.startsWith('/') || sourcePath.includes('..')) {
    return { ok: false, code: 'SOURCE_PATH_INVALID', message: `sourcePath must be a workspace-relative path (got "${sourcePath}").` }
  }
  const dir = assetsDir(home, appId)
  const absoluteSource = resolve(workspaceRoot, sourcePath)
  if (!absoluteSource.startsWith(resolve(workspaceRoot) + '/')) {
    return { ok: false, code: 'SOURCE_PATH_INVALID', message: 'sourcePath escapes the workspace root.' }
  }
  let bytes: Buffer
  try {
    bytes = await readFile(absoluteSource)
  } catch {
    return { ok: false, code: 'SOURCE_NOT_FOUND', message: `no workspace file at "${sourcePath}".` }
  }
  if (bytes.length > ASSET_MAX_BYTES) {
    return { ok: false, code: 'ASSET_TOO_LARGE', message: `asset is ${bytes.length} bytes; the per-asset cap is ${ASSET_MAX_BYTES} (compress or convert).` }
  }
  if (!sniffMatches(mediaType, bytes.subarray(0, 16))) {
    return { ok: false, code: 'MIME_UNSUPPORTED', message: `content sniffing does not match the ".${ext}" extension — renamed files are rejected.` }
  }
  const target = join(dir, basename(name))
  let overwritten = false
  try {
    const before = await quotaUsed(dir)
    const existing = await stat(target).then(info => info.size, () => -1)
    if (existing >= 0) overwritten = true
    if (before - Math.max(existing, 0) + bytes.length > ASSET_QUOTA_BYTES) {
      return { ok: false, code: 'ASSET_QUOTA_EXCEEDED', message: `this write would push the app past its ${ASSET_QUOTA_BYTES}-byte quota (currently ${before}); list assets and overwrite large ones, or suggest a reinstall.` }
    }
    await mkdir(dir, { recursive: true })
    await writeFile(target, bytes)
  } catch (error) {
    return { ok: false, code: 'STORE_WRITE_FAILED', message: `asset write failed: ${error instanceof Error ? error.message : String(error)} (same-name retry is idempotent).` }
  }
  const used = await quotaUsed(dir)
  return {
    ok: true,
    result: { ok: true, appId, name, url: assetUrl(appId, name), mediaType, bytes: bytes.length, overwritten, quotaUsedBytes: used },
  }
}

/** List one app's assets with quota usage (B10). */
export async function listAssets(home: string, appId: string): Promise<{ assets: AssetEntry[]; quotaUsedBytes: number; quotaLimitBytes: number }> {
  const dir = assetsDir(home, appId)
  const assets: AssetEntry[] = []
  let total = 0
  try {
    const names = (await readdir(dir)).sort()
    for (const name of names) {
      const info = await stat(join(dir, name))
      if (!info.isFile()) continue
      const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
      const mediaType = ASSET_MEDIA_TYPES[ext] ?? 'application/octet-stream'
      assets.push({ name, url: assetUrl(appId, name), mediaType, bytes: info.size, updatedAt: info.mtime.toISOString() })
      total += info.size
    }
  } catch {
    /* an absent directory lists as empty */
  }
  return { assets, quotaUsedBytes: total, quotaLimitBytes: ASSET_QUOTA_BYTES }
}

/** Remove one app's whole asset directory (the uninstall path). */
/**
 * Delete one named asset (M6e). The name is a stored-path basename — no
 * separators, no `..` (same fence as write). Callers that know a doc still
 * references the url should say so in their UX; the tool description makes
 * the dangling-reference tradeoff explicit.
 */
export async function deleteAsset(home: string, appId: string, name: string): Promise<{ ok: true } | { ok: false; code: 'ASSET_NOT_FOUND' | 'ASSET_NAME_INVALID'; message: string }> {
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('..')) {
    return { ok: false, code: 'ASSET_NAME_INVALID', message: `Asset name "${name}" is not a plain basename.` }
  }
  const target = join(assetsDir(home, appId), name)
  const existed = await stat(target).then(() => true, () => false)
  if (!existed) return { ok: false, code: 'ASSET_NOT_FOUND', message: `Asset "${name}" does not exist under this app.` }
  await rm(target, { force: true })
  return { ok: true }
}

/**
 * Orphan-scan (M6e): assets whose mtime is older than the conservative
 * window AND whose url is not textually present in the doc — advisory only.
 * A dynamic拼装 assetUrl must never be auto-deleted (it can look unreferenced
 * to every scan), so this returns candidates with ages; deletion is a
 * separate user-confirmed action, never automatic.
 */
export async function scanOrphanAssets(
  home: string, appId: string, docText: string, windowMs: number = ORPHAN_WINDOW_MS,
): Promise<{ candidates: { name: string; ageMs: number; bytes: number }[] }> {
  const dir = assetsDir(home, appId)
  const names = await readdir(dir).catch(() => [] as string[])
  const now = Date.now()
  const candidates: { name: string; ageMs: number; bytes: number }[] = []
  for (const name of names.sort()) {
    const info = await stat(join(dir, name)).catch(() => undefined)
    if (info === undefined || !info.isFile()) continue
    if (docText.includes(assetUrl(appId, name))) continue
    // Clamp: APFS mtime is sub-millisecond float while Date.now() is integer
    // ms, so a just-written file can read as fractionally "in the future".
    // Its true age is 0, never negative.
    const ageMs = Math.max(0, now - info.mtimeMs)
    if (ageMs >= windowMs) candidates.push({ name, ageMs, bytes: info.size })
  }
  return { candidates }
}

/** Conservative age before an unreferenced asset is even a GC candidate. */
export const ORPHAN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export async function removeAssets(home: string, appId: string): Promise<void> {
  await rm(assetsDir(home, appId), { recursive: true, force: true })
}
