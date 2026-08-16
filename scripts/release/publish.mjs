/**
 * Family publish: npm-publishes every @ryanyujazz package and bundle at the
 * VERSION baseline. A prerelease version never takes the `latest` dist-tag —
 * it always publishes under `next` (the official dsh publish rule).
 *
 * Usage: node scripts/release/publish.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()
const tag = version.includes('-') ? 'next' : 'latest'

function manifests(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(dir, entry.name, 'package.json')
    if (existsSync(file)) out.push(file)
  }
  return out
}

const planned = [...manifests(join(root, 'packages')), ...manifests(join(root, 'bundles'))]
  .map((file) => JSON.parse(readFileSync(file, 'utf8')))
  .filter((manifest) => manifest.name.startsWith('@ryanyujazz/'))
  .filter((manifest) => manifest.version === version)

if (planned.length === 0) throw new Error(`no @ryanyujazz packages at v${version}`)
console.log(`publishing v${version} under the "${tag}" dist-tag:`)
for (const manifest of planned) console.log(`  ${manifest.name}`)

execSync(`pnpm -r publish --tag ${tag} --no-git-checks`, { cwd: root, stdio: 'inherit' })
console.log('published.')
