/**
 * Ensure node-pty's prebuilt spawn-helper binaries keep their executable bit.
 * pnpm can restore the package from the store without preserving the mode bit
 * (and does not run dependency install scripts by default), after which every
 * posix_spawnp of the helper fails with "posix_spawnp failed." — the terminal
 * panel dies. Runs from the root postinstall so a fresh install heals itself.
 */
import { chmodSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const pnpmDir = join(process.cwd(), 'node_modules', '.pnpm')
let fixed = 0
try {
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith('node-pty@')) continue
    const prebuilds = join(pnpmDir, entry, 'node_modules', 'node-pty', 'prebuilds')
    for (const platform of readdirSync(prebuilds)) {
      const helper = join(prebuilds, platform, 'spawn-helper')
      try {
        const mode = statSync(helper).mode
        if ((mode & 0o111) === 0) {
          chmodSync(helper, mode | 0o755)
          fixed += 1
        }
      } catch {
        // no helper for this platform layout — skip
      }
    }
  }
} catch {
  // node_modules not populated yet — nothing to fix
}
console.log(fixed > 0 ? `fix-node-pty: restored +x on ${fixed} spawn-helper(s)` : 'fix-node-pty: nothing to fix')
