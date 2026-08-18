#!/usr/bin/env node
/** Create or refresh the managed DeepCreator profile without changing the source Web profile. */

import { execFileSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const sourceName = process.env.DEEPCREATOR_SOURCE_PROFILE ?? 'web'
const targetName = 'deepcreator'
const sourceDir = join(dshHome, 'profiles', sourceName)
const targetDir = join(dshHome, 'profiles', targetName)
const bundlePath = join(root, 'packages', 'bundle', 'deepcreator-web')
const dshBin = join(root, 'apps', 'desktop', 'node_modules', '.bin', 'dsh')

const OWNED_DEPENDENCIES = new Set([
  '@ryanyujazz/dsh-execflow-chat',
  '@ryanyujazz/dsh-deepcreator-web',
  '@ryanyujazz/dsh-client-compat',
  '@ryanyujazz/dsh-client-locale',
  '@ryanyujazz/dsh-client-ui-agent-preset',
  '@ryanyujazz/dsh-client-ui-conversation',
  '@ryanyujazz/dsh-client-ui-layout',
  '@ryanyujazz/dsh-client-ui-model-selection',
  '@ryanyujazz/dsh-client-ui-permission-presets',
  '@ryanyujazz/dsh-client-ui-primitives',
  '@ryanyujazz/dsh-client-ui-settings',
  '@ryanyujazz/dsh-client-ui-settings-general',
  '@ryanyujazz/dsh-client-ui-sidebar',
  '@ryanyujazz/dsh-client-ui-subagent',
  '@ryanyujazz/dsh-client-ui-theme',
  '@ryanyujazz/dsh-client-ui-tool',
  '@ryanyujazz/dsh-client-ui-trajectory',
  '@ryanyujazz/dsh-client-ui-user-questions',
  '@ryanyujazz/dsh-client-ui-workbench',
  '@ryanyujazz/dsh-client-ui-workbench-activity',
  '@ryanyujazz/dsh-client-ui-workbench-artifact',
  '@ryanyujazz/dsh-client-ui-workbench-tools',
  '@ryanyujazz/dsh-client-workbench-remotes',
  '@ryanyujazz/dsh-client-ui-workspace',
  '@ryanyujazz/dsh-artifacts',
  '@ryanyujazz/dsh-session-admin',
  '@ryanyujazz/dsh-review',
  '@ryanyujazz/dsh-skills',
  '@ryanyujazz/dsh-terminal-workbench',
])
const LEGACY_ROW_IDS = new Set(['execflow-conversation', 'execflow-tool'])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function backup(path, name, backupRoot) {
  if (!existsSync(path)) return
  cpSync(path, join(backupRoot, name), { recursive: true })
}

/** Remove only the two obsolete direct-insert rows while preserving all unrelated patch text. */
function migratePatch(source) {
  const lines = source.trimEnd().split('\n')
  const firstEntry = lines.findIndex(line => /^-\s/.test(line))
  if (firstEntry === -1) return source.trimEnd()
  const output = lines.slice(0, firstEntry)
  for (let start = firstEntry; start < lines.length;) {
    let end = start + 1
    while (end < lines.length && !/^-\s/.test(lines[end])) end += 1
    const block = lines.slice(start, end)
    const directId = /^- id:\s*([^\s#]+)/.exec(block[0])?.[1]
    if (directId !== undefined && LEGACY_ROW_IDS.has(directId)) {
      start = end
      continue
    }
    if (/^- insert:\s*$/.test(block[0])) {
      const nestedStarts = []
      for (let index = 1; index < block.length; index += 1) {
        if (/^ {4}- id:\s*/.test(block[index])) nestedStarts.push(index)
      }
      if (nestedStarts.length > 0) {
        const kept = block.slice(0, nestedStarts[0])
        for (let index = 0; index < nestedStarts.length; index += 1) {
          const nestedStart = nestedStarts[index]
          const nestedEnd = nestedStarts[index + 1] ?? block.length
          const nested = block.slice(nestedStart, nestedEnd)
          const nestedId = /^ {4}- id:\s*([^\s#]+)/.exec(nested[0])?.[1]
          if (nestedId === undefined || !LEGACY_ROW_IDS.has(nestedId)) kept.push(...nested)
        }
        if (kept.some(line => /^ {4}- id:\s*/.test(line))) output.push(...kept)
        start = end
        continue
      }
    }
    output.push(...block)
    start = end
  }
  const migrated = output.join('\n').trim()
  return migrated === '' ? '[]' : migrated
}

if (!existsSync(join(sourceDir, 'package.json'))) {
  throw new Error(`DeepCreator profile migration: source profile "${sourceName}" does not exist at ${sourceDir}`)
}
if (!existsSync(join(bundlePath, 'package.json'))) {
  throw new Error(`DeepCreator profile migration: bundle does not exist at ${bundlePath}`)
}

const sourceManifest = readJson(join(sourceDir, 'package.json'))
const bundleManifest = readJson(join(bundlePath, 'package.json'))
const existingTarget = existsSync(join(targetDir, 'package.json'))
  ? readJson(join(targetDir, 'package.json'))
  : undefined
if (existingTarget !== undefined && existingTarget.deepcreator?.managed !== true) {
  throw new Error(`DeepCreator profile migration: refusing to overwrite unmanaged profile at ${targetDir}`)
}

const backupRoot = join(dshHome, 'backups', 'deepcreator-migration', timestamp())
mkdirSync(backupRoot, { recursive: true })
backup(sourceDir, sourceName, backupRoot)
backup(targetDir, targetName, backupRoot)

const sourceBundles = sourceManifest.dsh?.profile?.bundles
if (!Array.isArray(sourceBundles)) {
  throw new Error(`DeepCreator profile migration: ${join(sourceDir, 'package.json')} has no dsh.profile.bundles array`)
}
const thirdPartyBundles = sourceBundles.filter(bundle =>
  bundle !== '@deepseek-ai/dsh-base'
  && bundle !== '@deepseek-ai/dsh-web-app'
  && bundle !== '@ryanyujazz/dsh-execflow-chat'
  && bundle !== '@ryanyujazz/dsh-deepcreator-web')

const dependencies = {}
for (const [name, spec] of Object.entries(sourceManifest.dependencies ?? {})) {
  if (!OWNED_DEPENDENCIES.has(name)) dependencies[name] = spec
}
dependencies['@ryanyujazz/dsh-deepcreator-web'] = `link:${bundlePath}`
for (const name of [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-terminal',
  '@deepseek-ai/dsh-terminal-bash',
  '@deepseek-ai/dsh-typert-protocol',
]) {
  dependencies[name] = bundleManifest.dependencies[name]
}
for (const entry of readdirSync(join(root, 'packages', 'client'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageDir = join(root, 'packages', 'client', entry.name)
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = readJson(manifestPath)
  if (manifest.dsh?.client === undefined) continue
  dependencies[manifest.name] = `link:${packageDir}`
}
for (const entry of readdirSync(join(root, 'packages', 'host'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const packageDir = join(root, 'packages', 'host', entry.name)
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = readJson(manifestPath)
  dependencies[manifest.name] = `link:${packageDir}`
}

const targetManifest = {
  name: 'dsh-profile-deepcreator',
  private: true,
  dependencies,
  dsh: {
    profile: {
      bundles: [
        '@deepseek-ai/dsh-base',
        '@deepseek-ai/dsh-web-app',
        ...thirdPartyBundles,
        '@ryanyujazz/dsh-deepcreator-web',
      ],
    },
  },
  deepcreator: {
    managed: true,
    profileVersion: 2,
    sourceProfile: sourceName,
  },
}

mkdirSync(targetDir, { recursive: true })
writeFileSync(join(targetDir, 'package.json'), `${JSON.stringify(targetManifest, null, 2)}\n`)
const sourceComposition = join(sourceDir, 'cordis.yml')
writeFileSync(
  join(targetDir, 'cordis.yml'),
  existsSync(sourceComposition) ? readFileSync(sourceComposition, 'utf8') : '[]\n',
)
const sourceWorkspace = join(sourceDir, 'pnpm-workspace.yaml')
writeFileSync(
  join(targetDir, 'pnpm-workspace.yaml'),
  existsSync(sourceWorkspace)
    ? readFileSync(sourceWorkspace, 'utf8')
    : 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
)

const inheritedPatchPath = join(sourceDir, 'cordis.patch.yml')
const inheritedPatch = existsSync(inheritedPatchPath)
  ? readFileSync(inheritedPatchPath, 'utf8').trimEnd()
  : '[]'
writeFileSync(join(targetDir, 'cordis.patch.yml'), `${migratePatch(inheritedPatch)}\n`)

execFileSync('pnpm', ['install', '--dir', targetDir], { stdio: 'inherit', shell: process.platform === 'win32' })
if (!existsSync(dshBin)) {
  throw new Error(`DeepCreator profile migration: dsh CLI is unavailable at ${dshBin}; run pnpm install in ${root}`)
}
// Node cannot exec the extensionless .bin shim on Windows; run the dsh CLI entry under the current Node.
const dshEntry = join(root, 'apps', 'desktop', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const dump = execFileSync(process.execPath, [dshEntry, '--profile', targetName, '--dump-config'], {
  cwd: root,
  env: { ...process.env, DSH_HOME: dshHome },
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})
if (!dump.includes('@ryanyujazz/dsh-client-ui-conversation')
  || !dump.includes('@ryanyujazz/dsh-client-ui-layout')
  || !dump.includes('@ryanyujazz/dsh-client-ui-workbench')
  || !dump.includes('@ryanyujazz/dsh-client-workbench-remotes')
  || !dump.includes('@ryanyujazz/dsh-artifacts')
  || !dump.includes('@ryanyujazz/dsh-review')
  || !dump.includes('@ryanyujazz/dsh-terminal-workbench')
  || dump.includes('execflow-conversation')
  || dump.includes('execflow-tool')) {
  throw new Error('DeepCreator profile migration: composed config omitted required DeepCreator UI rows')
}
writeFileSync(join(targetDir, 'deepcreator.dump.yml'), dump)
console.log(`DeepCreator profile ready: ${targetDir}`)
console.log(`Backup: ${backupRoot}`)
