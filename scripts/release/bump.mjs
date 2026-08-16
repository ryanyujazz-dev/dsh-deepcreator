/**
 * Family version bump: rewrites VERSION and every package/bundle manifest to
 * one shared version, then commits. One version line = one git tag per
 * release (the official dsh family pattern).
 *
 * Usage:
 *   node scripts/release/bump.mjs              # patch bump (0.1.0 -> 0.1.1)
 *   node scripts/release/bump.mjs --prerelease rc   # next prerelease (0.1.0 -> 0.1.0-rc.1)
 *   node scripts/release/bump.mjs --set 0.2.0  # explicit version
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const versionFile = join(root, 'VERSION')
const args = process.argv.slice(2)
const setIndex = args.indexOf('--set')
const preIndex = args.indexOf('--prerelease')

const current = readFileSync(versionFile, 'utf8').trim()

function nextVersion(version, prerelease) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(rc|beta)\.(\d+))?$/.exec(version)
  if (!match) throw new Error(`VERSION "${version}" is not semver`)
  const [, major, minor, patch, tag, tagNum] = match
  if (prerelease !== undefined) {
    if (tag === prerelease) return `${major}.${minor}.${patch}-${prerelease}.${Number(tagNum) + 1}`
    return `${major}.${minor}.${patch}-${prerelease}.1`
  }
  if (tag !== undefined) return `${major}.${minor}.${patch}`
  return `${major}.${minor}.${Number(patch) + 1}`
}

const to = setIndex !== -1
  ? args[setIndex + 1]
  : nextVersion(current, preIndex !== -1 ? args[preIndex + 1] : undefined)
if (to === undefined || !/^\d+\.\d+\.\d+(?:-(rc|beta)\.\d+)?$/.test(to)) {
  throw new Error(`invalid target version "${to}"`)
}

function manifests(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(dir, entry.name, 'package.json')
    if (existsSync(file)) out.push(file)
  }
  return out
}

const targets = [...manifests(join(root, 'packages')), ...manifests(join(root, 'bundles'))]
for (const file of targets) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.version = to
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
}
writeFileSync(versionFile, `${to}\n`)

execSync('git add VERSION packages bundles package.json pnpm-lock.yaml', { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "release(dsh-plugins): v${to}"`, { cwd: root, stdio: 'inherit' })
console.log(`bumped to v${to}; tag it after the commit merges: git tag plugins-v${to} <merge commit> && git push origin plugins-v${to}`)
