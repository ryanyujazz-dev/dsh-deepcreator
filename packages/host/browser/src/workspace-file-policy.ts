import { lstat, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { BrowserRuntimeError } from './errors.ts'

/** Resolve a regular upload file while rejecting workspace escapes and symlinks. */
export async function resolveWorkspaceUpload(workspaceRoot: string, candidate: string): Promise<string> {
  try {
    const root = await realpath(workspaceRoot)
    const unresolved = resolve(workspaceRoot, candidate)
    const source = await lstat(unresolved)
    if (source.isSymbolicLink()) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'Upload symlinks are rejected.')
    const target = await realpath(unresolved)
    const path = relative(root, target)
    if (path === '..' || path.startsWith(`..${sep}`) || resolve(root, path) !== target) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'Upload path escapes the current workspace.')
    if (!source.isFile()) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'Uploads accept regular workspace files only.')
    return target
  } catch (error) {
    if (error instanceof BrowserRuntimeError) throw error
    throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `Upload file is unavailable: ${candidate}`)
  }
}
