import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  appDataChanges, appDataDir, appDataDrop, appDataGet, appDataSet,
  DOC_MAX_BYTES, VALUE_MAX_BYTES, workspaceToken,
} from '../src/appdata.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'appdata-'))
}

describe('AppData dual-domain storage', () => {
  it('starts empty, writes key paths, and replays the journal', async () => {
    const home = await tempHome()
    expect(await appDataGet('installed', 'kanban', undefined, undefined, '1', home)).toEqual({ value: {}, rev: 0 })
    const first = await appDataSet('installed', 'kanban', 'board.cols.todo', [{ title: '买奶' }], 'test:1', undefined, '1', home)
    const second = await appDataSet('installed', 'kanban', 'board.cols.done', [], 'test:2', undefined, '1', home)
    expect(first.rev).toBe(1)
    expect(second.rev).toBe(2)
    const doc = await appDataGet('installed', 'kanban', undefined, undefined, '1', home)
    expect(doc.value).toEqual({ board: { cols: { todo: [{ title: '买奶' }], done: [] } } })
    expect(doc.rev).toBe(2)
    const path = await appDataGet('installed', 'kanban', 'board.cols.todo.0.title', undefined, '1', home)
    expect(path.value).toBe('买奶')
    const changes = await appDataChanges('installed', 'kanban', 0, undefined, home)
    expect(changes.map(entry => entry.path)).toEqual(['board.cols.todo', 'board.cols.done'])
    expect(changes.map(entry => entry.rev)).toEqual([1, 2])
  })

  it('isolates dev (workspace-keyed) from installed domains', async () => {
    const home = await tempHome()
    const wsA = await mkdtemp(join(tmpdir(), 'ws-a-'))
    const wsB = await mkdtemp(join(tmpdir(), 'ws-b-'))
    await appDataSet('dev', 'kanban', 'count', 1, 'a', wsA, '1', home)
    await appDataSet('dev', 'kanban', 'count', 2, 'b', wsB, '1', home)
    await appDataSet('installed', 'kanban', 'count', 3, 'c', undefined, '1', home)
    expect((await appDataGet('dev', 'kanban', 'count', wsA, '1', home)).value).toBe(1)
    expect((await appDataGet('dev', 'kanban', 'count', wsB, '1', home)).value).toBe(2)
    expect((await appDataGet('installed', 'kanban', 'count', undefined, '1', home)).value).toBe(3)
    // Workspace addressing is by opaque token, never by path.
    expect(appDataDir('dev', 'kanban', wsA, home)).not.toContain(wsA.split('/').pop()!)
    expect(appDataDir('dev', 'kanban', wsA, home)).toContain(workspaceToken(wsA))
  })

  it('rejects illegal paths and oversize values with machine codes', async () => {
    const home = await tempHome()
    await expect(appDataSet('installed', 'x', 'Not A Path', 1, 'c', undefined, '1', home)).rejects.toThrow('PATH_INVALID')
    await expect(appDataSet('installed', 'x', 'a.b', 'z'.repeat(VALUE_MAX_BYTES), 'c', undefined, '1', home)).rejects.toThrow('VALUE_TOO_LARGE')
    // Document cap: sixteen sub-cap values push the whole document past 4 MiB.
    let docFailure = ''
    for (let index = 0; index < 24; index += 1) {
      try {
        await appDataSet('installed', 'x', `k${index}`, 'z'.repeat(VALUE_MAX_BYTES - 64), 'c', undefined, '1', home)
      } catch (error) {
        docFailure = error instanceof Error ? error.message : String(error)
        break
      }
    }
    expect(docFailure).toContain('DOC_TOO_LARGE')
  })

  it('drops the whole domain on uninstall and keeps a torn journal tolerable', async () => {
    const home = await tempHome()
    await appDataSet('installed', 'old', 'k', 1, 'c', undefined, '1', home)
    await appDataDrop('installed', 'old', undefined, home)
    expect(await appDataGet('installed', 'old', undefined, undefined, '1', home)).toEqual({ value: {}, rev: 0 })
    const dir = appDataDir('installed', 'torn', undefined, home)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'journal.jsonl'), '{"rev":1,"path":"a","value":1,"causeId":"c","ts":"t"}\n{"rev":2,"pat', 'utf8')
    const changes = await appDataChanges('installed', 'torn', 0, undefined, home)
    expect(changes.map(entry => entry.rev)).toEqual([1])
  })

  it('compacts the journal past the keep watermark', async () => {
    const home = await tempHome()
    for (let index = 0; index < 30; index += 1) {
      await appDataSet('installed', 'busy', `k${index}`, index, `c${index}`, undefined, '1', home)
    }
    const raw = await readFile(join(appDataDir('installed', 'busy', undefined, home), 'journal.jsonl'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(30)
    expect((await appDataGet('installed', 'busy', 'k29', undefined, '1', home)).value).toBe(29)
  })
})
