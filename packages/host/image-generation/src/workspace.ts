import { mkdir, lstat, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

export async function writeWorkspacePng(workspaceRoot: string, requestedPath: string, data: Uint8Array): Promise<string> {
  if (requestedPath.trim() === '' || path.isAbsolute(requestedPath)) throw new Error('output_path must be a non-empty workspace-relative path ending in .png.')
  if (path.extname(requestedPath).toLowerCase() !== '.png') throw new Error('output_path must end in .png; create_image normalizes provider output to PNG.')
  const root = await realpath(workspaceRoot)
  const target = path.resolve(root, requestedPath)
  if (!inside(root, target)) throw new Error('output_path escapes the workspace.')
  const parent = path.dirname(target)
  await mkdir(parent, { recursive: true })
  const realParent = await realpath(parent)
  if (!inside(root, realParent)) throw new Error('output_path resolves through a directory outside the workspace.')
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error('output_path may not overwrite a symbolic link.')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = path.join(realParent, `.${path.basename(target)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, data, { flag: 'wx' })
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
  return path.relative(root, target)
}
