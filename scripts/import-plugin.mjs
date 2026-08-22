/**
 * Import a fork package from a dsh checkout into this library.
 *
 * Copies src/tests + the manifest/build files (when the target does not
 * exist yet), then rewrites the manifest for the standalone library:
 *   - scope @deepseek-ai -> @ryanyujazz, repository -> dsh-deepcreator
 *   - version -> the family VERSION baseline
 *   - `workspace:^` dependency specifiers pinned to the tested dsh range
 *     (cordis/schemastery to their concrete versions)
 *   - tsconfig replaced with a standalone config (deps resolve from
 *     node_modules, no project references)
 *   - tsdown.config.ts retargeted to scripts/tsdown.client.ts
 *
 * Usage:
 *   node scripts/import-plugin.mjs <dsh-checkout> <source-package-dir> <target-name>
 *   node scripts/import-plugin.mjs ../deepseek-harness packages/client/ui-conversation ui-conversation
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [checkout, sourceDir, targetName] = process.argv.slice(2)
if (checkout === undefined || sourceDir === undefined || targetName === undefined) {
  throw new Error('usage: node scripts/import-plugin.mjs <dsh-checkout> <source-package-dir> <target-name>')
}
if (!targetName.match(/^[a-z0-9-]+$/)) throw new Error(`invalid target name "${targetName}"`)

// Tested dsh dependency range (the fork packages peer against it) and the
// exact build-time version (devDependencies pin the tested contract; peers
// keep the range so newer dsh versions warn instead of hard-failing).
const DSH_RANGE = '^0.1.1-rc.2'
const DSH_BUILD = '0.1.1-rc.2'
const PINNED = { '@deepseek-ai/cordis': '4.0.1', '@deepseek-ai/schemastery': '3.18.1' }
const DEEPCREATOR_CLIENT_PACKAGES = new Set([
  'locale',
  'ui-agent-preset',
  'ui-conversation',
  'ui-layout',
  'ui-model-selection',
  'ui-permission-presets',
  'ui-primitives',
  'ui-settings',
  'ui-settings-general',
  'ui-sidebar',
  'ui-subagent',
  'ui-theme',
  'ui-tool',
  'ui-trajectory',
  'ui-user-questions',
  'ui-workspace',
])

const forkName = (name) => {
  const prefix = '@deepseek-ai/dsh-client-'
  if (!name.startsWith(prefix)) return name
  const shortName = name.slice(prefix.length)
  return DEEPCREATOR_CLIENT_PACKAGES.has(shortName) ? `@ryanyujazz/dsh-client-${shortName}` : name
}

const source = join(checkout, sourceDir)
const target = join(root, 'packages', 'client', targetName)
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()

if (!existsSync(target)) {
  mkdirSync(target, { recursive: true })
  cpSync(join(source, 'package.json'), join(target, 'package.json'))
  cpSync(join(source, 'src'), join(target, 'src'), { recursive: true })
  if (existsSync(join(source, 'tests'))) cpSync(join(source, 'tests'), join(target, 'tests'), { recursive: true })
  for (const file of ['tsdown.config.ts', 'README.md', 'README.zh.md']) {
    const from = join(source, file)
    if (existsSync(from)) cpSync(from, join(target, file))
  }
}

// Manifest rewrite.
const manifestPath = join(target, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.name = forkName(manifest.name)
manifest.version = version
manifest.repository = {
  type: 'git',
  url: 'git+https://github.com/ryanyujazz-dev/dsh-deepcreator.git',
  directory: `packages/client/${targetName}`,
}
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
  const deps = manifest[section]
  if (deps === undefined) continue
  for (const [name, spec] of Object.entries(deps)) {
    if (name.startsWith('@ryanyujazz/dsh-client-')) {
      deps[name] = section === 'peerDependencies' ? '^0.1.0' : 'workspace:^'
      continue
    }
    const nextName = forkName(name)
    if (nextName !== name) {
      delete deps[name]
      deps[nextName] = section === 'peerDependencies' ? '^0.1.0' : 'workspace:^'
      continue
    }
    if (name in PINNED) {
      deps[name] = PINNED[name]
      continue
    }
    if (name.startsWith('@deepseek-ai/dsh-') || spec === 'workspace:^') {
      deps[name] = section === 'devDependencies' ? DSH_BUILD : DSH_RANGE
    }
  }
}
if (manifest.dsh?.client?.inject !== undefined) {
  manifest.dsh.client.inject = manifest.dsh.client.inject.map(forkName)
}
manifest.scripts = {
  ...manifest.scripts,
  bundle: 'tsc -p tsconfig.json && tsdown',
  typecheck: 'tsc -p tsconfig.json --noEmit',
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// Standalone tsconfig: same compiler shape as the dsh client base, but with
// no project references — dependencies resolve from node_modules. Self
// references (the package's own module specifiers, used by the conversation
// node `declare module` augmentations) map back to source: relative module
// augmentation only attaches when the specifier resolves to the real module,
// and the built consumer side must carry the fork-scope specifiers.
const sourceName = `@ryanyujazz/dsh-client-${targetName}`
const tsconfig = {
  compilerOptions: {
    target: 'es2024',
    module: 'esnext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    lib: ['ES2024', 'DOM', 'DOM.Iterable'],
    types: [],
    declaration: true,
    sourceMap: true,
    declarationMap: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    rootDir: 'src',
    outDir: 'lib/types',
    paths: {
      [`${sourceName}/client`]: ['./src/client/index.ts'],
      [sourceName]: ['./src/index.ts'],
      [`${sourceName}/invariant`]: ['./src/invariant.ts'],
    },
  },
  include: ['src'],
}
writeFileSync(join(target, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`)

// The retargeted tsdown preset import (the source imported a sibling in the
// dsh checkout; here the preset lives in scripts/).
const tsdownPath = join(target, 'tsdown.config.ts')
if (existsSync(tsdownPath)) {
  let config = readFileSync(tsdownPath, 'utf8')
  config = config.replace("'../tsdown.client.ts'", "'../../../scripts/tsdown.client.ts'")
  for (const shortName of DEEPCREATOR_CLIENT_PACKAGES) {
    config = config.replaceAll(
      `@deepseek-ai/dsh-client-${shortName}`,
      `@ryanyujazz/dsh-client-${shortName}`,
    )
  }
  writeFileSync(tsdownPath, config)
}

// Self-referential module specifiers inside the sources (the `declare module`
// augmentations and any self imports) move to the fork scope, so the EMITTED
// declaration files attach the merges for consumers. Everything else keeps
// the @deepseek-ai scope (stock packages resolve from node_modules).
const rewrite = (dir) => {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) rewrite(path)
    if (!entry.isFile() || !entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue
    const text = readFileSync(path, 'utf8')
    let rewritten = text
    for (const shortName of DEEPCREATOR_CLIENT_PACKAGES) {
      const official = `@deepseek-ai/dsh-client-${shortName}`
      const fork = `@ryanyujazz/dsh-client-${shortName}`
      rewritten = rewritten.split(official).join(fork)
    }
    if (rewritten !== text) writeFileSync(path, rewritten)
  }
}
rewrite(join(target, 'src'))
if (existsSync(join(target, 'tests'))) rewrite(join(target, 'tests'))

console.log(`imported packages/${targetName} as ${manifest.name}@${version}`)
