/**
 * User-level install store and AppData domain layout (skeleton).
 *
 * The filesystem is the only source of truth (v0.0.5): the installed list is
 * read straight off `current.json` pointers, dev data domains are addressed
 * by workspace + appId, and no index is double-written. Publishing writes
 * arrive in M3; this module owns the paths and the pointer read so both the
 * registry and the future publish chain share one spelling.
 * @module @ryanyujazz/dsh-app-stage/store
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppInstalledEntry, AppManifest } from './types.ts'
import { validateManifestBytes } from './manifest.ts'

/** Resolved DSH harness home (`$DSH_HOME`, default `~/.dsh`). */
export function dshHome(): string {
  const home = process.env.DSH_HOME
  if (home !== undefined && home !== '') return resolve(home)
  return resolve(homedir(), '.dsh')
}

/** STORE_ROOT anchor for every App Stage durable fact. */
export function storeRoot(home: string = dshHome()): string {
  return join(home, 'deepcreator')
}

/** Installed snapshot directory for one app version. */
export function installedVersionDir(appId: string, version: string, home: string = dshHome()): string {
  return join(storeRoot(home), 'apps', 'installed', appId, version)
}

/** `current.json` pointer path for one installed app. */
export function installedPointerPath(appId: string, home: string = dshHome()): string {
  return join(storeRoot(home), 'apps', 'installed', appId, 'current.json')
}

/** The `current.json` pointer record (install-time facts). */
export interface InstallPointer {
  readonly appId: string
  readonly version: string
  readonly digest: string
  readonly installedAt: string
  readonly sourceWorkspace: string
  readonly sourceFingerprint: string
  readonly sourceSession: string
  readonly publishedVia: string
}

/** Read one installed app's pointer, or undefined when none is installed. */
export async function readInstallPointer(appId: string, home: string = dshHome()): Promise<InstallPointer | undefined> {
  try {
    const raw = await readFile(installedPointerPath(appId, home), 'utf8')
    const parsed = JSON.parse(raw) as Partial<InstallPointer>
    if (
      typeof parsed.appId !== 'string' || parsed.appId !== appId
      || typeof parsed.version !== 'string' || typeof parsed.digest !== 'string'
      || typeof parsed.installedAt !== 'string' || typeof parsed.sourceWorkspace !== 'string'
      || typeof parsed.sourceFingerprint !== 'string' || typeof parsed.sourceSession !== 'string'
      || typeof parsed.publishedVia !== 'string'
    ) return undefined
    return parsed as InstallPointer
  } catch {
    return undefined
  }
}

/** Every app id with an installed pointer directory. */
export async function installedAppIds(home: string = dshHome()): Promise<readonly string[]> {
  try {
    const entries = await readdir(join(storeRoot(home), 'apps', 'installed'), { withFileTypes: true })
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch {
    return []
  }
}

/** Launcher "opened" state: which version the user last opened per app (blue dot source). */
export async function readOpenedVersions(home: string = dshHome()): Promise<Readonly<Record<string, string>>> {
  try {
    const raw = await readFile(join(storeRoot(home), 'apps', 'opened.json'), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [appId, version] of Object.entries(parsed)) {
      if (typeof version === 'string') out[appId] = version
    }
    return out
  } catch {
    return {}
  }
}

/** Record that the user opened one installed version (clears the blue dot). */
export async function recordOpenedVersion(appId: string, version: string, home: string = dshHome()): Promise<void> {
  const current = { ...await readOpenedVersions(home) }
  current[appId] = version
  await writeFile(join(storeRoot(home), 'apps', 'opened.json'), `${JSON.stringify(current, null, 2)}\n`)
}

/** The global timeline watermark (`activity-seen.json`): the last activity
 * seq the user has seen. One single watermark across all installed apps —
 * the timeline is a global feed, never per-workspace (presence §3.6). */
export async function readActivitySeen(home: string = dshHome()): Promise<number> {
  try {
    const raw = JSON.parse(await readFile(join(storeRoot(home), 'apps', 'activity-seen.json'), 'utf8')) as { seq?: unknown }
    return typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : 0
  } catch {
    return 0
  }
}

/** Advance the watermark (clears the activity blue dot). */
export async function writeActivitySeen(seq: number, home: string = dshHome()): Promise<void> {
  await writeFile(join(storeRoot(home), 'apps', 'activity-seen.json'), `${JSON.stringify({ seq }, null, 2)}\n`)
}

/**
 * Materialize one installed entry: pointer + snapshot manifest read with the
 * same completeness gate as dev copies (digest verification lands with the
 * publish chain in M3; a missing snapshot dir reads as broken here).
 */
export async function readInstalledEntry(appId: string, home: string = dshHome()): Promise<AppInstalledEntry> {
  const pointer = await readInstallPointer(appId, home)
  if (pointer === undefined) {
    return {
      scope: 'installed', appId, status: 'broken',
      reason: { code: 'runtime.broken', detail: `current.json pointer missing for "${appId}"`, fix: 'Reinstall the app or remove its leftover directory.' },
    }
  }
  const snapshotDir = installedVersionDir(appId, pointer.version, home)
  let manifest: AppManifest | undefined
  try {
    const bytes = await readFile(join(snapshotDir, 'app.json'))
    const validated = validateManifestBytes(appId, bytes)
    if (!validated.ok) {
      return {
        scope: 'installed', appId, status: 'broken', reason: validated.reason,
        pointer: pointerEntry(pointer),
      }
    }
    manifest = validated.manifest
  } catch {
    return {
      scope: 'installed', appId, status: 'broken',
      reason: { code: 'runtime.broken', detail: `snapshot manifest unreadable under ${snapshotDir}`, fix: 'Reinstall the app to restore its snapshot.' },
      pointer: pointerEntry(pointer),
    }
  }
  return { scope: 'installed', appId, status: 'ready', manifest, pointer: pointerEntry(pointer) }
}

function pointerEntry(pointer: InstallPointer) {
  return {
    version: pointer.version,
    digest: pointer.digest,
    installedAt: pointer.installedAt,
    sourceWorkspace: pointer.sourceWorkspace,
    sourceFingerprint: pointer.sourceFingerprint,
    publishedVia: pointer.publishedVia,
  }
}
