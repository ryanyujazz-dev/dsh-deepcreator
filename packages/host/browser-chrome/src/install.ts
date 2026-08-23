import { spawn } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CHROME_NATIVE_HOST_NAME = 'com.deepcreator.browser'
export const CHROME_EXTENSION_ID = 'dekchimjaohlgopidiieeiajoikneppe'
function dshRoot(): string { return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh')) }
/** Node binary the installed Native Messaging host must be launched with. Chrome runs hosts from a minimal environment, so a PATH-based `#!/usr/bin/env node` shebang fails on machines where node is installed outside /usr/bin. Resolve an absolute path from the installer's own process, preferring Homebrew's stable opt link. */
function nodeBinary(): string {
  if (process.platform === 'darwin') {
    const real = resolve(process.execPath)
    if (real.startsWith('/opt/homebrew/Cellar/')) return '/opt/homebrew/opt/node/bin/node'
    if (real.startsWith('/usr/local/Cellar/')) return '/usr/local/opt/node/bin/node'
  }
  return process.execPath
}
async function rewriteHostShebang(hostPath: string): Promise<void> {
  const source = await readFile(hostPath, 'utf8')
  if (!source.startsWith('#!')) return
  const newline = source.indexOf('\n')
  const body = newline < 0 ? '' : source.slice(newline + 1)
  await writeFile(hostPath, `#!${nodeBinary()}\n${body}`)
}
function manifestPath(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${CHROME_NATIVE_HOST_NAME}.json`)
  if (process.platform === 'linux') return join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts', `${CHROME_NATIVE_HOST_NAME}.json`)
  return join(dshRoot(), 'browser', 'chrome', `${CHROME_NATIVE_HOST_NAME}.json`)
}
function run(command: string, args: string[]): Promise<void> { return new Promise((done, reject) => { const child = spawn(command, args, { stdio: 'ignore', windowsHide: true }); child.once('error', reject); child.once('exit', code => code === 0 ? done() : reject(new Error(`${command} exited ${String(code)}`))) }) }

/** Explicit install/repair entry point for Settings UI. Normal Provider startup never calls it. */
export async function installChromeIntegration(extensionId = CHROME_EXTENSION_ID): Promise<{ manifestPath: string; hostPath: string }> {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('A fixed 32-character Chrome extension ID is required before installing the Native Messaging host.')
  const hostPath = join(dshRoot(), 'browser', 'chrome', 'native-host.cjs')
  await mkdir(dirname(hostPath), { recursive: true, mode: 0o700 })
  const source = fileURLToPath(new URL('./native-host.cjs', import.meta.url))
  await copyFile(source, hostPath); await rewriteHostShebang(hostPath); await chmod(hostPath, 0o700)
  const target = manifestPath(); await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await writeFile(target, JSON.stringify({ name: CHROME_NATIVE_HOST_NAME, description: 'DeepCreator Chrome Browser Provider', path: hostPath, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2), { mode: 0o600 })
  if (process.platform === 'win32') await run('reg.exe', ['add', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${CHROME_NATIVE_HOST_NAME}`, '/ve', '/t', 'REG_SZ', '/d', target, '/f'])
  return { manifestPath: target, hostPath }
}

export async function uninstallChromeIntegration(): Promise<void> {
  const target = manifestPath()
  if (process.platform === 'win32') await run('reg.exe', ['delete', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${CHROME_NATIVE_HOST_NAME}`, '/f']).catch(() => undefined)
  await rm(target, { force: true })
  await rm(join(dshRoot(), 'browser', 'chrome', 'native-host.cjs'), { force: true })
}
