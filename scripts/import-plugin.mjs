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

// Tested dsh dependency range (the fork packages peer against it) and the
// exact build-time version (devDependencies pin the tested contract; peers
// keep the range so newer dsh versions warn instead of hard-failing).
const DSH_RANGE = '^0.1.0-rc.5'
const DSH_BUILD = '0.1.0-rc.5'
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
    deps[name] = PINNED[name] ?? (section === 'devDependencies' ? DSH_BUILD : DSH_RANGE)
  }
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

// Standalone tsconfig: same compiler shape as the dsh client base, but with
// no project references — dependencies resolve from node_modules. Self
// references (the package's own module specifiers, used by the conversation
// node `declare module` augmentations) map back to source: relative module
// augmentation only attaches when the specifier resolves to the real module,
// and the built consumer side must carry the fork-scope specifiers.
const sourceName = manifest.name.replace('@ryanyujazz/', '@deepseek-ai/')
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
  const config = readFileSync(tsdownPath, 'utf8')
  writeFileSync(tsdownPath, config.replace("'../tsdown.client.ts'", "'../../scripts/tsdown.client.ts'"))
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
    if (text.includes(`'${sourceName}`)) {
      writeFileSync(path, text.split(`'${sourceName}`).join(`'${manifest.name}`))
    }
  }
}
rewrite(join(target, 'src'))

console.log(`imported packages/${targetName} as ${manifest.name}@${version}`)
