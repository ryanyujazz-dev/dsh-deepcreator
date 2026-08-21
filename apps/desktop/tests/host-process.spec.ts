import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveDesktopDshLaunch, resolveDesktopWorkspace } from '../src/dsh-launch.ts'
import { parseDesktopHostUrl, startDesktopHost } from '../src/host-process.ts'

const noop = (): void => {}

describe('parseDesktopHostUrl', () => {
  it('accepts only the settled Web profile loopback URL line', () => {
    expect(parseDesktopHostUrl('dsh web: http://127.0.0.1:4312')?.href)
      .toBe('http://127.0.0.1:4312/')
    expect(parseDesktopHostUrl('dsh web: http://127.0.0.1:4312 (LAN: http://10.0.0.2:4312)')?.port)
      .toBe('4312')
    expect(parseDesktopHostUrl('dsh web: http://localhost:4312')).toBeUndefined()
    expect(parseDesktopHostUrl('dsh web: https://127.0.0.1:4312')).toBeUndefined()
    expect(parseDesktopHostUrl('noise')).toBeUndefined()
  })
})

describe('startDesktopHost', () => {
  it('waits for readiness and owns idempotent bounded shutdown', async () => {
    const host = await startDesktopHost({
      command: process.execPath,
      args: ['-e', "console.log('noise'); console.log('dsh web: http://127.0.0.1:4312'); setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: process.env,
      startupTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
      onStdout: noop,
      onStderr: noop,
    })
    expect(host.url.href).toBe('http://127.0.0.1:4312/')
    await Promise.all([host.stop(), host.stop()])
    await expect(host.exited).resolves.toMatchObject({ code: null, signal: 'SIGTERM' })
  })

  it('rejects and cleans up when the child exits before readiness', async () => {
    await expect(startDesktopHost({
      command: process.execPath,
      args: ['-e', 'process.exit(7)'],
      cwd: process.cwd(),
      env: process.env,
      startupTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
      onStdout: noop,
      onStderr: noop,
    })).rejects.toThrow('Host exited before readiness (code 7')
  })

  it('bounds a child that never prints readiness', async () => {
    await expect(startDesktopHost({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      env: process.env,
      startupTimeoutMs: 20,
      shutdownTimeoutMs: 1_000,
      onStdout: noop,
      onStderr: noop,
    })).rejects.toThrow('did not become ready within 20ms')
  })
})

describe('desktop DSH launch', () => {
  // A real absolute base built with the same path operations the launcher
  // uses, so the expected values hold on every platform (Windows would
  // otherwise drive-prefix the POSIX-style literals the test previously
  // hardcoded).
  const root = resolve(process.cwd(), 'host-process-spec')
  const resolver = (source: boolean) => ({
    exists: () => source,
    resolveTsx: (repoRoot: string) => join(repoRoot, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs'),
  })

  it('uses system Node and tsx for a source checkout', () => {
    const launch = resolveDesktopDshLaunch(
      join(root, 'apps', 'cli', 'package.json'),
      { NODE: 'node-bin' },
      resolver(true),
    )
    expect(launch).toEqual({
      command: 'node-bin',
      args: [
        '--import',
        pathToFileURL(join(root, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href,
        join(root, 'apps', 'cli', 'src', 'bin.ts'),
        '--profile', 'deepcreator', '--port', '0',
      ],
      env: { NODE: 'node-bin', TSX_TSCONFIG_PATH: join(root, 'tsconfig.json') },
    })
  })

  it('uses system Node for an installed CLI', () => {
    const launch = resolveDesktopDshLaunch(
      join(root, 'install', 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
      {},
      resolver(false),
    )
    expect(launch).toEqual({
      command: 'node',
      args: [
        join(root, 'install', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
        '--profile', 'deepcreator', '--port', '0',
      ],
      env: {},
    })
  })

  it('preserves the explicit command origin as the Workspace', () => {
    const chosen = join(root, 'chosen')
    const packageDir = join(root, 'package')
    const current = join(root, 'current')
    expect(resolveDesktopWorkspace({ DSH_DESKTOP_WORKSPACE: chosen, INIT_CWD: packageDir }, current))
      .toBe(chosen)
    expect(resolveDesktopWorkspace({ INIT_CWD: packageDir }, current)).toBe(packageDir)
    expect(resolveDesktopWorkspace({}, current)).toBe(current)
  })
})
