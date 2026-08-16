/**
 * Import a fork package from a dsh checkout into this library.
 *
 * Copies src/tests + the manifest/build files (when the target does not
 * exist yet), then rewrites the manifest for the standalone library:
 *   - scope @deepseek-ai -> @ryanyujazz, repository -> dsh-plugins
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
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const [checkout, sourceDir, targetName] = process.argv.slice(2)
if (checkout === undefined || sourceDir === undefined || targetName === undefined) {
  throw new Error('usage: node scripts/import-plugin.mjs <dsh-checkout> <source-package-dir> <target-name>')
}
if (!targetName.match(/^[a-z0-9-]+$/)) throw new Error(`invalid target name "${targetName}"`)

// Tested dsh dependency range (the fork packages peer against it).
const DSH_RANGE = '^0.1.0-rc.5'
const PINNED = { '@deepseek-ai/cordis': '4.0.1', '@deepseek-ai/schemastery': '3.18.1' }

const source = join(checkout, sourceDir)
const target = join(root, 'packages', targetName)
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim()

if (!existsSync(target)) {
  mkdirSync(target, { recursive: true })
  cpSync(join(source, 'src'), join(target, 'src'), { recursive: true })
  if (existsSync(join(source, 'tests'))) cpSync(join(source, 'tests'), join(target, 'tests'), { recursive: true })
  for (const file of ['tsdown.config.ts', 'README.md', 'README.zh.md', 'README.i18n.yaml']) {
    const from = join(source, file)
    if (existsSync(from)) cpSync(from, join(target, file))
  }
}

// Manifest rewrite.
const manifestPath = join(target, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.name = manifest.name.replace('@deepseek-ai/', '@ryanyujazz/')
manifest.version = version
manifest.repository = {
  type: 'git',
  url: 'git+https://github.com/ryanyujazz-dev/dsh-plugins.git',
  directory: `packages/${targetName}`,
}
for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
  const deps = manifest[section]
  if (deps === undefined) continue
  for (const [name, spec] of Object.entries(deps)) {
    if (spec !== 'workspace:^') continue
    deps[name] = PINNED[name] ?? DSH_RANGE
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// Standalone tsconfig: same compiler shape as the dsh client base, but with
// no project references and no source paths — every dependency resolves from
// node_modules.
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
  },
  include: ['src'],
}
writeFileSync(join(target, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`)

// Retarget the tsdown preset import (the source imported a sibling in the dsh
// checkout; here the preset lives in scripts/).
const tsdownPath = join(target, 'tsdown.config.ts')
if (existsSync(tsdownPath)) {
  const config = readFileSync(tsdownPath, 'utf8')
  writeFileSync(tsdownPath, config.replace("'../tsdown.client.ts'", "'../../scripts/tsdown.client.ts'"))
}

console.log(`imported packages/${targetName} as ${manifest.name}@${version}`)
