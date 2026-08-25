/**
 * The App Stage discovery registry.
 *
 * Two supply sources: the user-level install store (global) and workspace
 * dev copies (`.deepcreator/apps/<appId>/`). Enumeration is honest by
 * construction — every directory under a dev root becomes an entry, passing
 * or failing the completeness gate, and the installed store reads its
 * `current.json` pointers. M1 refreshes on demand (probe-at-open); the
 * session-bound watcher set arrives in M2.
 * @module @ryanyujazz/dsh-app-stage/registry
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDevEntry, AppInstalledEntry, AppManifest } from './types.ts'
import { APPS_DIR } from './types.ts'
import { validateManifestBytes } from './manifest.ts'
import { installedAppIds, readInstalledEntry } from './store.ts'

/** Every workspace's dev-root directory (records universe, registry order). */
export function devRootFor(workspacePath: string): string {
  return join(workspacePath, APPS_DIR)
}

/**
 * Scan one workspace's dev root: one entry per directory, gated.
 * Unreadable roots yield an empty list (a workspace with no apps directory is
 * the common case, not an error).
 */
export async function scanDevRoot(workspacePath: string, installedIds: ReadonlySet<string>): Promise<readonly AppDevEntry[]> {
  const root = devRootFor(workspacePath)
  let dirs: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    dirs = entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name).sort()
  } catch {
    return []
  }
  const results: AppDevEntry[] = []
  for (const appId of dirs) {
    results.push(await gateDevEntry(join(root, appId), appId, installedIds.has(appId)))
  }
  return results
}

/** Gate one dev app directory: manifest validation + declared-file existence. */
export async function gateDevEntry(dir: string, appId: string, conflictsWithInstalled: boolean): Promise<AppDevEntry> {
  let manifest: AppManifest | undefined
  try {
    const bytes = await readFile(join(dir, 'app.json'))
    const validated = validateManifestBytes(appId, bytes)
    if (!validated.ok) return { scope: 'dev', appId, status: 'rejected', reason: validated.reason, conflictsWithInstalled }
    manifest = validated.manifest
  } catch {
    return {
      scope: 'dev', appId, status: 'rejected', conflictsWithInstalled,
      reason: { code: 'manifest.invalid', detail: 'app.json is missing or unreadable', fix: 'Create app.json at the app directory root with the manifest v1 fields.' },
    }
  }
  const missing: string[] = []
  if (!(await fileExists(join(dir, manifest.entry)))) missing.push(`entry "${manifest.entry}"`)
  if (manifest.icon !== undefined && !(await fileExists(join(dir, manifest.icon)))) missing.push(`icon "${manifest.icon}"`)
  if (manifest.agentGuide !== undefined && !(await fileExists(join(dir, manifest.agentGuide)))) missing.push(`agentGuide "${manifest.agentGuide}"`)
  if (missing.length > 0) {
    return {
      scope: 'dev', appId, status: 'incomplete', manifest, conflictsWithInstalled,
      reason: { code: 'gate.incomplete', detail: `declared files missing: ${missing.join(', ')}`, fix: 'Restore the declared files, or drop the declarations from app.json.' },
    }
  }
  if (manifest.agentGuide !== undefined) {
    const guideBytes = await readFile(join(dir, manifest.agentGuide)).catch(() => new Uint8Array())
    if (guideBytes.byteLength > 32 * 1024) {
      return {
        scope: 'dev', appId, status: 'rejected', manifest, conflictsWithInstalled,
        reason: { code: 'manifest.invalid', detail: `agentGuide is ${guideBytes.byteLength} bytes, over 32768`, fix: 'Trim the guide to 32 KiB or less.' },
      }
    }
  }
  return { scope: 'dev', appId, status: 'ready', manifest, conflictsWithInstalled }
}

/** All installed entries (global; empty store reads as an empty list). */
export async function listInstalled(home: string): Promise<readonly AppInstalledEntry[]> {
  const ids = await installedAppIds(home)
  const results: AppInstalledEntry[] = []
  for (const appId of ids) results.push(await readInstalledEntry(appId, home))
  return results
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}
