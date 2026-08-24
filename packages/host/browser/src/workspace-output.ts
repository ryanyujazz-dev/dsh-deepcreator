import { link, lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export class BrowserOutputPathError extends Error {}

async function nearestExisting(candidate: string, root: string): Promise<string> {
  let current = candidate
  while (inside(root, current)) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (current === root) break
      current = path.dirname(current)
    }
  }
  throw new BrowserOutputPathError('outputPath has no existing ancestor inside the workspace.')
}

/** Create one non-overwriting Browser screenshot under the workspace output tree. */
export async function writeBrowserScreenshot(workspaceRoot: string, requestedPath: string, data: Uint8Array): Promise<string> {
  if (requestedPath.trim() === '' || path.isAbsolute(requestedPath)) {
    throw new BrowserOutputPathError('outputPath must be a non-empty workspace-relative PNG path under output/browser/screenshots/.')
  }
  if (path.extname(requestedPath).toLowerCase() !== '.png') {
    throw new BrowserOutputPathError('outputPath must end in .png.')
  }

  const normalized = path.normalize(requestedPath)
  const prefix = path.join('output', 'browser', 'screenshots')
  if (normalized !== prefix && !normalized.startsWith(`${prefix}${path.sep}`)) {
    throw new BrowserOutputPathError('outputPath must be under output/browser/screenshots/.')
  }

  const root = await realpath(workspaceRoot)
  const target = path.resolve(root, normalized)
  if (!inside(root, target)) throw new BrowserOutputPathError('outputPath escapes the workspace.')

  const parent = path.dirname(target)
  const ancestor = await nearestExisting(parent, root)
  if (await realpath(ancestor) !== ancestor) {
    throw new BrowserOutputPathError('outputPath may not traverse a symbolic link.')
  }
  await mkdir(parent, { recursive: true })
  if (await realpath(parent) !== parent) {
    throw new BrowserOutputPathError('outputPath may not traverse a symbolic link.')
  }

  try {
    await lstat(target)
    throw new BrowserOutputPathError('outputPath already exists; choose a new screenshot filename.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const temporary = path.join(parent, `.${path.basename(target)}.${randomUUID()}.tmp`)
  await writeFile(temporary, data, { flag: 'wx' })
  try {
    // A same-directory hard link atomically publishes the complete file and
    // refuses to replace a path another call created after the lstat check.
    await link(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  await unlink(temporary).catch(() => undefined)
  return path.relative(root, target)
}
