#!/usr/bin/env node
/** Launch the packaged Electron application from an ordinary command shell. */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDesktopWorkspace } from './dsh-launch.ts'

const require = createRequire(import.meta.url)
const electronPath: unknown = require('electron')
if (typeof electronPath !== 'string') {
  throw new Error('deepcreator: the electron package did not resolve an executable')
}
const packageRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const workspace = resolveDesktopWorkspace(process.env, process.cwd())
const result = spawnSync(electronPath, [packageRoot, ...process.argv.slice(2)], {
  cwd: workspace,
  env: { ...process.env, DSH_DESKTOP_WORKSPACE: workspace },
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.signal !== null) {
  process.kill(process.pid, result.signal)
} else {
  process.exitCode = result.status ?? 1
}
