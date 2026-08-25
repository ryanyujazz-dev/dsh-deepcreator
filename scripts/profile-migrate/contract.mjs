import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const MANAGED_PROFILE_VERSION = 4
export const RETIRED_PROFILE_DEPENDENCIES = new Set([
  '@ryanyujazz/dsh-browser-mcp',
])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Resolve workspace dependencies contributed by the active presentation bundle. */
export function requiredWorkspaceLinks(root, bundlePath) {
  const bundleManifest = readJson(join(bundlePath, 'package.json'))
  const requested = new Set(
    Object.entries(bundleManifest.dependencies ?? {})
      .filter(([, spec]) => typeof spec === 'string' && spec.startsWith('workspace:'))
      .map(([name]) => name),
  )
  const links = new Map([[bundleManifest.name, `link:${bundlePath}`]])
  for (const group of ['client', 'host']) {
    const groupPath = join(root, 'packages', group)
    for (const entry of readdirSync(groupPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const packagePath = join(groupPath, entry.name)
      const manifestPath = join(packagePath, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = readJson(manifestPath)
      if (requested.has(manifest.name)) links.set(manifest.name, `link:${packagePath}`)
    }
  }
  return links
}

/** Decide whether the source checkout must refresh its managed DSH profile. */
export function managedProfileNeedsRefresh(targetDir, targetManifest, requiredLinks) {
  if (targetManifest?.deepcreator?.managed !== true
    || targetManifest.deepcreator.profileVersion !== MANAGED_PROFILE_VERSION) return true
  const dependencies = targetManifest.dependencies ?? {}
  for (const retired of RETIRED_PROFILE_DEPENDENCIES) {
    if (dependencies[retired] !== undefined) return true
  }
  for (const [name, spec] of requiredLinks) {
    if (dependencies[name] !== spec) return true
    if (!existsSync(join(targetDir, 'node_modules', ...name.split('/')))) return true
  }
  return false
}
