import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserOutputPathError, writeBrowserScreenshot } from '../src/workspace-output.ts'

const temporary: string[] = []
afterEach(async () => {
  await Promise.all(temporary.splice(0).map(target => rm(target, { recursive: true, force: true })))
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-browser-output-'))
  temporary.push(root)
  return root
}

describe('Browser workspace screenshot output', () => {
  it('atomically publishes one PNG under the dedicated output tree', async () => {
    const root = await workspace()
    const data = Buffer.from('png-bytes')

    await expect(writeBrowserScreenshot(root, 'output/browser/screenshots/final.png', data))
      .resolves.toBe(path.join('output', 'browser', 'screenshots', 'final.png'))
    await expect(readFile(path.join(root, 'output/browser/screenshots/final.png'))).resolves.toEqual(data)
    expect(await readdir(path.join(root, 'output/browser/screenshots'))).toEqual(['final.png'])
  })

  it('rejects paths outside the Browser screenshot output tree and refuses overwrite', async () => {
    const root = await workspace()
    await expect(writeBrowserScreenshot(root, '../escape.png', Buffer.from('x'))).rejects.toBeInstanceOf(BrowserOutputPathError)
    await expect(writeBrowserScreenshot(root, 'output/other.png', Buffer.from('x'))).rejects.toBeInstanceOf(BrowserOutputPathError)
    await expect(writeBrowserScreenshot(root, 'output/browser/screenshots/not-png.jpg', Buffer.from('x'))).rejects.toBeInstanceOf(BrowserOutputPathError)
    await mkdir(path.join(root, 'output/browser/screenshots'), { recursive: true })
    await writeFile(path.join(root, 'output/browser/screenshots/existing.png'), 'original')
    await expect(writeBrowserScreenshot(root, 'output/browser/screenshots/existing.png', Buffer.from('replacement')))
      .rejects.toThrow('already exists')
    await expect(readFile(path.join(root, 'output/browser/screenshots/existing.png'), 'utf8')).resolves.toBe('original')
  })

  it('rejects a screenshot output tree that traverses a directory symlink', async () => {
    const root = await workspace()
    const outside = await workspace()
    await mkdir(path.join(outside, 'browser/screenshots'), { recursive: true })
    await symlink(outside, path.join(root, 'output'), process.platform === 'win32' ? 'junction' : undefined)

    await expect(writeBrowserScreenshot(root, 'output/browser/screenshots/escaped.png', Buffer.from('secret')))
      .rejects.toThrow('symbolic link')
    await expect(readFile(path.join(outside, 'browser/screenshots/escaped.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
