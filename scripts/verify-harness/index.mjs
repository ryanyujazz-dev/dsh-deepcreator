#!/usr/bin/env node
/** Verify the supported Harness version and DeepCreator bundle composition. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const compatibility = JSON.parse(readFileSync(join(root, 'packages/client/compat/compatibility.json'), 'utf8'))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const installedDsh = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
const failures = []

if (installedDsh.version !== compatibility.harnessVersion) {
  failures.push(`installed @deepseek-ai/dsh is ${installedDsh.version}; expected ${compatibility.harnessVersion}`)
}

const workspaceConfig = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
for (const patchName of [
  `@deepseek-ai/dsh-tool-fs@${compatibility.harnessVersion}`,
  `@deepseek-ai/dsh-tools@${compatibility.harnessVersion}`,
]) {
  if (!workspaceConfig.includes(patchName)) failures.push(`pnpm workspace omits required diff metadata patch ${patchName}`)
}
for (const patchFile of [
  `patches/@deepseek-ai__dsh-tool-fs@${compatibility.harnessVersion}.patch`,
  `patches/@deepseek-ai__dsh-tools@${compatibility.harnessVersion}.patch`,
]) {
  const absolute = join(root, patchFile)
  if (!existsSync(absolute)) failures.push(`required diff metadata patch is missing: ${patchFile}`)
  else {
    const source = readFileSync(absolute, 'utf8')
    if (!source.includes('oldStart') || !source.includes('newStart')) failures.push(`${patchFile} no longer carries oldStart/newStart`)
  }
}

try {
  const toolRequire = createRequire(join(root, 'packages/client/ui-tool/package.json'))
  const fsTool = await import(pathToFileURL(toolRequire.resolve('@deepseek-ai/dsh-tool-fs')).href)
  const hunks = fsTool.computeHunkDiffs('verify.ts', 'one\ntwo\nthree\nfour\nfive\n', 'one\ntwo\nchanged\nfour\nfive\n')
  if (hunks[0]?.oldStart !== 1 || hunks[0]?.newStart !== 1) failures.push('patched dsh-tool-fs does not emit absolute hunk starts')
} catch (error) {
  failures.push(`cannot verify patched dsh-tool-fs metadata: ${error instanceof Error ? error.message : String(error)}`)
}

const clientRoot = join(root, 'packages', 'client')
const names = new Set()
for (const entry of readdirSync(clientRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifestPath = join(clientRoot, entry.name, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (names.has(manifest.name)) failures.push(`duplicate package name ${manifest.name}`)
  names.add(manifest.name)
  for (const section of ['dependencies', 'peerDependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (name.startsWith('@deepseek-ai/dsh-') && String(spec).includes('workspace:')) {
        failures.push(`${manifest.name} keeps unresolved official workspace dependency ${name}@${spec}`)
      }
      if (
        name.startsWith('@deepseek-ai/dsh-')
        && /\d+\.\d+\.\d+(?:-[\w.]+)?/.test(String(spec))
        && !String(spec).includes(compatibility.harnessVersion)
      ) {
        failures.push(`${manifest.name} targets unsupported Harness dependency ${name}@${spec}`)
      }
      if (name === '@deepseek-ai/dsh-client-web-react' || name === '@deepseek-ai/dsh-client-schema-form') {
        failures.push(`${manifest.name} depends on removed official package ${name}`)
      }
    }
  }
}

const bundlePatch = readFileSync(join(root, 'packages/bundle/deepcreator-web/cordis.patch.yml'), 'utf8')
if (!bundlePatch.includes('- id: ui-brand-official\n  disabled: true')) {
  failures.push('deepcreator-web must disable the official brand row while DeepCreator owns brand seats')
}
if (bundlePatch.includes('- id: ui-settings\n  disabled: true')) {
  failures.push('deepcreator-web must retain the official settings base and its schema/mirror services')
}
for (const required of [
  '@ryanyujazz/dsh-client-locale',
  '@ryanyujazz/dsh-client-ui-primitives',
  '@ryanyujazz/dsh-client-ui-layout',
  '@ryanyujazz/dsh-client-ui-sidebar',
  '@ryanyujazz/dsh-client-ui-settings',
  '@ryanyujazz/dsh-client-ui-settings-general',
  '@ryanyujazz/dsh-client-ui-conversation',
  '@ryanyujazz/dsh-client-ui-tool',
  '@ryanyujazz/dsh-client-ui-trajectory',
  '@ryanyujazz/dsh-client-ui-workspace',
  '@ryanyujazz/dsh-client-ui-agent-preset',
  '@ryanyujazz/dsh-client-ui-model-selection',
  '@ryanyujazz/dsh-client-ui-permission-presets',
  '@ryanyujazz/dsh-client-ui-subagent',
  '@ryanyujazz/dsh-client-ui-user-questions',
  '@ryanyujazz/dsh-client-ui-image-generation',
  '@ryanyujazz/dsh-client-workbench-remotes',
  '@ryanyujazz/dsh-client-presentation',
  '@ryanyujazz/dsh-client-ui-workbench',
  '@ryanyujazz/dsh-client-ui-workbench-activity',
  '@ryanyujazz/dsh-client-ui-workbench-artifact',
  '@ryanyujazz/dsh-client-ui-workbench-tools',
  '@ryanyujazz/dsh-artifacts',
  '@ryanyujazz/dsh-presentation',
  '@ryanyujazz/dsh-session-admin',
  '@ryanyujazz/dsh-review',
  '@ryanyujazz/dsh-terminal-workbench',
  '@ryanyujazz/dsh-image-generation',
  '@deepseek-ai/dsh-terminal',
  '@deepseek-ai/dsh-terminal-bash',
]) {
  if (!bundlePatch.includes(required)) failures.push(`deepcreator-web omits ${required}`)
}

// Manual recursion: pnpm materializes circular peer links (ui-conversation ↔
// ui-workbench) as alternating nested node_modules chains whose far end is a
// dead symlink; recursive readdir follows them and crashes (ENOENT or
// ENAMETOOLONG) before any post-hoc path filter can run. Skipping these
// directories on entry — and never following symlinked directories — keeps
// the walk on real source trees only.
const collectSourceFiles = (dir, out) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(path, out)
    else if (entry.isFile() && /\.(?:ts|tsx|css|md)$/.test(entry.name)) out.push(path)
  }
  return out
}
for (const path of collectSourceFiles(clientRoot, [])) {
  const source = readFileSync(path, 'utf8')
  if (source.includes('settings.general.preferences.item')) {
    failures.push(`${path} still uses the removed official preferences slot`)
  }
  if (source.includes('/Users/letitbery/dsh/deepseek-harness-master')) {
    failures.push(`${path} imports the modified Harness checkout by absolute path`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Harness compatibility verified: ${compatibility.harnessVersion} (${compatibility.harnessGitSha})`)
  console.log(`DeepCreator client packages verified: ${names.size}`)
}
