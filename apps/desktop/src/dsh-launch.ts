/** Resolve the DSH Host launcher for a source checkout or installed package. */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Complete child-process inputs for one DSH Web-profile Host. */
export interface DesktopDshLaunch {
  /** Executable that runs the CLI entry. */
  command: string
  /** Node options, CLI entry, and Web-profile arguments. */
  args: string[]
  /** Environment required by the selected launcher. */
  env: NodeJS.ProcessEnv
}

/** Filesystem and package-resolution operations used to choose a launcher. */
export interface DesktopDshLaunchResolver {
  /** Report whether the source CLI entry exists. */
  exists(path: string): boolean
  /** Resolve the tsx ESM hook from the repository root. */
  resolveTsx(repoRoot: string): string
}

const defaultResolver: DesktopDshLaunchResolver = {
  exists: existsSync,
  resolveTsx: repoRoot => createRequire(join(repoRoot, 'package.json')).resolve('tsx/esm'),
}

/**
 * Preserve the directory from which the desktop command was invoked.
 * @param env - launcher environment carrying the explicit handoff or package-manager origin.
 * @param cwd - current process directory used when no handoff exists.
 * @returns an absolute Workspace directory.
 */
export function resolveDesktopWorkspace(env: NodeJS.ProcessEnv, cwd: string): string {
  return resolve(env.DSH_DESKTOP_WORKSPACE ?? env.INIT_CWD ?? cwd)
}

/**
 * Resolve source-checkout and installed-package launches without mixing their
 * dependency-resolution models.
 * @param cliManifest - installed `@deepseek-ai/dsh/package.json` path.
 * @param env - environment inherited by the Host.
 * @param resolver - injectable source and tsx resolution operations.
 * @returns complete child-process inputs for the Web profile.
 */
export function resolveDesktopDshLaunch(
  cliManifest: string,
  env: NodeJS.ProcessEnv,
  resolver: DesktopDshLaunchResolver = defaultResolver,
): DesktopDshLaunch {
  const cliRoot = dirname(cliManifest)
  const sourceEntry = join(cliRoot, 'src', 'bin.ts')
  if (resolver.exists(sourceEntry)) {
    const repoRoot = resolve(cliRoot, '..', '..')
    const tsxEsm = pathToFileURL(resolver.resolveTsx(repoRoot)).href
    return {
      command: env.NODE ?? env.npm_node_execpath ?? 'node',
      args: ['--import', tsxEsm, sourceEntry, '--profile', 'deepcreator', '--port', '0'],
      env: { ...env, TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json') },
    }
  }
  return {
    command: env.NODE ?? env.npm_node_execpath ?? 'node',
    args: [join(cliRoot, 'lib', 'bin.js'), '--profile', 'deepcreator', '--port', '0'],
    env: { ...env },
  }
}
