import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const nodeFlags = process.allowedNodeEnvironmentFlags.has('--webstorage') ? ['--no-webstorage'] : []
const forwarded = process.argv.slice(2)
if (forwarded[0] === '--') forwarded.shift()
const result = spawnSync(process.execPath, [...nodeFlags, vitest, 'run', ...forwarded], {
  env: process.env,
  stdio: 'inherit',
})

if (result.error !== undefined) throw result.error
if (result.signal !== null) {
  console.error(`DeepCreator tests terminated by ${result.signal}.`)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
