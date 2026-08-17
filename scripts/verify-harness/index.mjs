#!/usr/bin/env node
/** Verify the supported Harness version and DeepCreator bundle composition. */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const compatibility = JSON.parse(readFileSync(join(root, 'packages/client/compat/compatibility.json'), 'utf8'))
const require = createRequire(join(root, 'apps/desktop/package.json'))
const installedDsh = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))
const failures = []

if (installedDsh.version !== compatibility.harnessVersion) {
  failures.push(`installed @deepseek-ai/dsh is ${installedDsh.version}; expected ${compatibility.harnessVersion}`)
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
      if (name.startsWith('@deepseek-ai/dsh-') && String(spec).includes('0.1.0-rc.5')) {
        failures.push(`${manifest.name} still targets old Harness dependency ${name}@${spec}`)
      }
    }
  }
}

const bundlePatch = readFileSync(join(root, 'packages/bundle/deepcreator-web/cordis.patch.yml'), 'utf8')
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
  '@ryanyujazz/dsh-client-workbench-remotes',
  '@ryanyujazz/dsh-artifacts',
  '@ryanyujazz/dsh-review',
  '@ryanyujazz/dsh-terminal-workbench',
  '@deepseek-ai/dsh-terminal',
  '@deepseek-ai/dsh-terminal-bash',
]) {
  if (!bundlePatch.includes(required)) failures.push(`deepcreator-web omits ${required}`)
}

const sourceFiles = readdirSync(clientRoot, { recursive: true, withFileTypes: true })
for (const file of sourceFiles) {
  if (!file.isFile() || !/\.(?:ts|tsx|css|md)$/.test(file.name)) continue
  const path = join(file.parentPath, file.name)
  if (path.includes('/node_modules/') || path.includes('/lib/')) continue
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
