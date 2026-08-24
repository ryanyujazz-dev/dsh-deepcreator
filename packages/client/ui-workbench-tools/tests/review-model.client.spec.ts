// @vitest-environment jsdom
// The Review panel's pure presentation model: parse-once layers, cache-
// keeping merges, event staleness marks, collapsed-cache eviction, settled
// mutation digests, and per-repository expansion persistence.

import { beforeEach, describe, expect, it } from 'vitest'
import type { ConversationNode, RunningToolCall, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReviewDiffResult, ReviewFileStatus } from '@ryanyujazz/dsh-review/types'
import {
  REVIEW_CACHE_LIMIT, decodeMutationSignal, encodeMutationSignal, evictCollapsedCaches, markStale,
  isReviewPanelFile, matchReviewFile, mergeFileEntries, mutationSignal, mutationToolPath, parseDiffResult, readExpandedPaths, ReviewDiffParser,
  sameDiffResult, writeExpandedPaths, type FileEntries, type FileEntry,
} from '../src/client/review-model.ts'

beforeEach(() => { localStorage.clear() })

const file = (path: string, over: Partial<ReviewFileStatus> = {}): ReviewFileStatus => ({
  path, index: ' ', workingTree: 'M', ...over,
})

const diffResult = (path: string, over: Partial<Extract<ReviewDiffResult, { ok: true }>> = {}): Extract<ReviewDiffResult, { ok: true }> => ({
  ok: true, repositoryRoot: '/w', path, layers: [{
    kind: 'working-tree',
    patch: `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`,
    oldSource: { revision: 'index', text: 'a' },
    newSource: { revision: 'worktree', text: 'b' },
  }], ...over,
})

const entry = (path: string, over: Partial<FileEntry> = {}): FileEntry => ({
  status: file(path),
  cache: { kind: 'ready', ...parseDiffResult(diffResult(path)), raw: diffResult(path) },
  stale: false,
  lastOpened: 0,
  fetching: false,
  ...over,
})

const stamp = (() => { let next = 0; return () => ++next })()

describe('Review file policy', () => {
  it('omits binary artifacts before they enter the Review list', () => {
    for (const path of [
      'report.pdf', 'deck.pptx', 'sheet.xlsx', 'image.svg', 'video.mp4',
      'bundle.zip', 'font.woff2', 'module.wasm', 'cache.sqlite',
    ]) expect(isReviewPanelFile(file(path))).toBe(false)
    expect(isReviewPanelFile(file('opaque.data', { presentation: 'binary' }))).toBe(false)
  })

  it('keeps reviewable text and Git-semantic entries', () => {
    for (const path of ['src/app.ts', 'pnpm-lock.yaml', 'snapshot.snap', 'notebook.ipynb', 'dist/app.min.js']) {
      expect(isReviewPanelFile(file(path))).toBe(true)
    }
    expect(isReviewPanelFile(file('linked.pdf', { kind: 'symlink', presentation: 'mode' }))).toBe(true)
    expect(isReviewPanelFile(file('vendor', { kind: 'submodule', presentation: 'submodule' }))).toBe(true)
  })
})

const toolResult = (seq: number, name: string, argsRaw: string, subCalls: readonly ConversationNode[] = []): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId: `c${seq}`, call: { name, argsRaw },
  callTime: seq * 1_000 - 1, content: [], isError: false, callView: null, resultView: null,
  subCalls: subCalls as ToolResultNode['subCalls'],
})

describe('mergeFileEntries', () => {
  it('keeps entry identity for unchanged status and drops departed files', () => {
    const previous: FileEntries = { 'src/a.ts': entry('src/a.ts'), 'gone.ts': entry('gone.ts') }
    const merged = mergeFileEntries(previous, [file('src/a.ts'), file('new.ts')], stamp)
    expect(merged['src/a.ts']).toBe(previous['src/a.ts'])
    expect(merged['gone.ts']).toBeUndefined()
    expect(merged['new.ts']?.cache.kind).toBe('empty')
  })

  it('carries the cache forward but marks it stale when the status moved', () => {
    const previous: FileEntries = { 'src/a.ts': entry('src/a.ts') }
    const merged = mergeFileEntries(previous, [file('src/a.ts', { workingTree: 'A' })], stamp)
    expect(merged['src/a.ts']).not.toBe(previous['src/a.ts'])
    expect(merged['src/a.ts']?.cache).toBe(previous['src/a.ts']?.cache)
    expect(merged['src/a.ts']?.stale).toBe(true)
  })

  it('does not mark loading entries stale', () => {
    const previous: FileEntries = { 'src/a.ts': entry('src/a.ts', { cache: { kind: 'loading' } }) }
    const merged = mergeFileEntries(previous, [file('src/a.ts', { workingTree: 'A' })], stamp)
    expect(merged['src/a.ts']?.stale).toBe(false)
  })
})

describe('markStale', () => {
  it('marks every ready entry with null paths and keeps the record reference otherwise', () => {
    const entries: FileEntries = { 'src/a.ts': entry('src/a.ts'), 'src/b.ts': entry('src/b.ts') }
    expect(markStale(entries, new Set(['missing.ts']))).toBe(entries)
    const all = markStale(entries, null)
    expect(all['src/a.ts']?.stale).toBe(true)
    expect(all['src/b.ts']?.stale).toBe(true)
    const targeted = markStale({ 'src/a.ts': entry('src/a.ts'), 'src/b.ts': entry('src/b.ts') }, new Set(['src/a.ts']))
    expect(targeted['src/a.ts']?.stale).toBe(true)
    expect(targeted['src/b.ts']?.stale).toBe(false)
  })
})

describe('evictCollapsedCaches', () => {
  it('evicts the oldest collapsed ready caches beyond the limit, exempting expanded and fetching', () => {
    const entries: FileEntries = {}
    // LIMIT + 3 entries; the oldest is expanded and the newest is mid-fetch,
    // so LIMIT + 1 stay evictable — exactly one eviction.
    for (let index = 0; index < REVIEW_CACHE_LIMIT + 3; index += 1) {
      entries[`f${index}.ts`] = entry(`f${index}.ts`, { lastOpened: index })
    }
    const expanded = new Set(['f0.ts'])
    entries[`f${REVIEW_CACHE_LIMIT + 2}.ts`] = entry(`f${REVIEW_CACHE_LIMIT + 2}.ts`, { lastOpened: REVIEW_CACHE_LIMIT + 2, fetching: true })
    const next = evictCollapsedCaches(entries, expanded, REVIEW_CACHE_LIMIT)
    expect(next).not.toBeNull()
    expect(next?.['f0.ts']?.cache.kind).toBe('ready')
    expect(next?.[`f${REVIEW_CACHE_LIMIT + 2}.ts`]?.cache.kind).toBe('ready')
    expect(next?.['f1.ts']?.cache.kind).toBe('empty')
    expect(next?.['f2.ts']?.cache.kind).toBe('ready')
  })

  it('returns null while under the limit', () => {
    const entries: FileEntries = { 'src/a.ts': entry('src/a.ts') }
    expect(evictCollapsedCaches(entries, new Set(), REVIEW_CACHE_LIMIT)).toBeNull()
  })

  it('honors the weighted byte budget while exempting resident files', () => {
    const large = 'x'.repeat(1_024)
    const largeEntry = (path: string, lastOpened: number) => entry(path, {
      lastOpened,
      cache: {
        kind: 'ready',
        ...parseDiffResult(diffResult(path, { layers: [{
          kind: 'working-tree', patch: large,
          oldSource: { revision: 'index', text: large },
          newSource: { revision: 'worktree', text: large },
        }] })),
        raw: diffResult(path, { layers: [{
          kind: 'working-tree', patch: large,
          oldSource: { revision: 'index', text: large },
          newSource: { revision: 'worktree', text: large },
        }] }),
      },
    })
    const next = evictCollapsedCaches({
      'resident.ts': largeEntry('resident.ts', 0),
      'old.ts': largeEntry('old.ts', 1),
    }, new Set(['resident.ts']), REVIEW_CACHE_LIMIT, 128)

    expect(next?.['resident.ts']?.cache.kind).toBe('ready')
    expect(next?.['old.ts']?.cache.kind).toBe('empty')
  })
})

describe('diff parsing', () => {
  it('parses layers once with merged snapshots and folded counts', () => {
    const parsed = parseDiffResult(diffResult('src/a.ts'))
    expect(parsed.layers).toHaveLength(1)
    expect(parsed.layers[0]?.files[0]?.hunks[0]).toMatchObject({
      oldText: 'a', newText: 'b', oldSource: 'a', newSource: 'b', deferHighlight: true,
    })
    expect(parsed).toMatchObject({ added: 1, removed: 1 })
  })

  it('sameDiffResult compares wire content', () => {
    expect(sameDiffResult(diffResult('src/a.ts'), diffResult('src/a.ts'))).toBe(true)
    expect(sameDiffResult(diffResult('src/a.ts'), diffResult('src/a.ts', { path: 'other.ts' }))).toBe(false)
  })

  it('posts patch-only work to a controller-owned Worker and disposes it', async () => {
    const workerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
    const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
    const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
    class FakeWorker {
      static instance: FakeWorker | undefined
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: ErrorEvent) => void) | null = null
      readonly messages: unknown[] = []
      terminated = false
      constructor(_url: string) { FakeWorker.instance = this }
      postMessage(value: unknown): void { this.messages.push(value) }
      terminate(): void { this.terminated = true }
    }
    try {
      Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: FakeWorker })
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:review-worker' })
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
      const parser = new ReviewDiffParser()
      const pending = parser.parse(diffResult('src/a.ts', { layers: [{
        kind: 'working-tree', patch: diffResult('src/a.ts').layers[0]!.patch,
        oldSource: { revision: 'index', text: null }, newSource: { revision: 'worktree', text: null },
      }] }))
      const worker = FakeWorker.instance
      expect(worker?.messages).toHaveLength(1)
      const posted = worker?.messages[0] as { id: number; layers: Array<{ patch: string; fallbackPath: string }> }
      expect(posted.layers[0]).toMatchObject({ fallbackPath: 'src/a.ts' })
      expect(posted.layers[0]?.patch).toContain('diff --git')
      worker?.onmessage?.({ data: {
        id: posted.id,
        layers: [[{
          oldPath: 'src/a.ts', path: 'src/a.ts', binary: false, added: 1, removed: 1,
          hunks: [{ path: 'src/a.ts', oldText: 'a', newText: 'b', oldStart: 1, newStart: 1 }],
        }]],
      } } as MessageEvent)
      await expect(pending).resolves.toMatchObject({ added: 1, removed: 1 })
      parser.dispose()
      expect(worker?.terminated).toBe(true)
    } finally {
      if (workerDescriptor === undefined) Reflect.deleteProperty(globalThis, 'Worker')
      else Object.defineProperty(globalThis, 'Worker', workerDescriptor)
      if (createDescriptor === undefined) Reflect.deleteProperty(URL, 'createObjectURL')
      else Object.defineProperty(URL, 'createObjectURL', createDescriptor)
      if (revokeDescriptor === undefined) Reflect.deleteProperty(URL, 'revokeObjectURL')
      else Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor)
    }
  })
})

describe('mutation signal', () => {
  it('counts settled mutation tools with targeted paths; running calls are excluded', () => {
    const nodes: ConversationNode[] = [
      toolResult(1, 'read', '{"path":"x"}'),
      toolResult(2, 'edit', '{"file_path":"src/a.ts"}'),
      toolResult(3, 'bash', '{"command":"make"}'),
    ]
    const signal = mutationSignal(nodes)
    expect(signal.count).toBe(2)
    expect(signal.lastSeq).toBe(3)
    expect(signal.lastName).toBe('bash')
    expect(signal.lastPath).toBeNull()
  })

  it('visits subCalls and reports the last targeted edit', () => {
    const nodes: ConversationNode[] = [
      toolResult(5, 'run_code', '{}', [toolResult(6, 'write', '{"path":"src/new.ts"}')]),
    ]
    const signal = mutationSignal(nodes)
    expect(signal.count).toBe(1)
    expect(signal.lastPath).toBe('src/new.ts')
  })

  it('encodes and decodes round-trip including unicode paths', () => {
    const signal = { count: 3, lastSeq: 9, lastName: 'edit', lastPath: '文档/演示 文件.ts' }
    expect(decodeMutationSignal(encodeMutationSignal(signal))).toEqual(signal)
    expect(decodeMutationSignal(encodeMutationSignal({ count: 0, lastSeq: 0, lastName: '', lastPath: null })))
      .toEqual({ count: 0, lastSeq: 0, lastName: '', lastPath: null })
  })

  it('mutationToolPath reads file_path or path and rejects malformed JSON', () => {
    expect(mutationToolPath('{"file_path":"a.ts"}')).toBe('a.ts')
    expect(mutationToolPath('{"path":"b.ts"}')).toBe('b.ts')
    expect(mutationToolPath('{"path":""}')).toBeNull()
    expect(mutationToolPath('not json')).toBeNull()
    expect(mutationToolPath(undefined)).toBeNull()
  })
})

describe('expansion persistence', () => {
  it('round-trips per repository and reports null for unknown roots', () => {
    writeExpandedPaths('/repo/one', ['src/a.ts', 'src/b.ts'])
    writeExpandedPaths('/repo/one', ['src/c.ts'])
    expect(readExpandedPaths('/repo/one')).toEqual(new Set(['src/c.ts']))
    expect(readExpandedPaths('/repo/two')).toBeNull()
  })

  it('trims the oldest paths beyond the cap and keeps the newest repositories', () => {
    const paths = Array.from({ length: 250 }, (_value, index) => `p${index}.ts`)
    writeExpandedPaths('/repo/capped', paths)
    const stored = readExpandedPaths('/repo/capped')
    expect(stored?.size).toBe(200)
    expect(stored?.has('p0.ts')).toBe(false)
    expect(stored?.has('p249.ts')).toBe(true)
    for (let index = 0; index < 12; index += 1) writeExpandedPaths(`/repo/r${index}`, ['x.ts'])
    writeExpandedPaths('/repo/newest', ['y.ts'])
    expect(readExpandedPaths('/repo/r0')).toBeNull()
    expect(readExpandedPaths('/repo/newest')).toEqual(new Set(['y.ts']))
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('dsh.deepcreator.review.expansion.v1', '{not json')
    expect(readExpandedPaths('/repo/one')).toBeNull()
    expect(() => writeExpandedPaths('/repo/one', ['a.ts'])).not.toThrow()
  })
})

describe('matchReviewFile', () => {
  const files = [
    { path: 'src/a.ts', index: ' ', workingTree: 'M' },
    { path: 'pkg/renamed.ts', oldPath: 'pkg/original.ts', index: 'R', workingTree: ' ' },
  ]

  it('matches exact identities including a rename old path', () => {
    expect(matchReviewFile(files, 'src/a.ts')).toBe('src/a.ts')
    expect(matchReviewFile(files, 'pkg/original.ts')).toBe('pkg/renamed.ts')
  })

  it('matches either-side suffixes across absolute and repository-relative forms', () => {
    expect(matchReviewFile(files, '/Users/dev/workspace/src/a.ts')).toBe('src/a.ts')
    expect(matchReviewFile(files, 'src\\a.ts')).toBe('src/a.ts')
    expect(matchReviewFile(files, 'workspace/src/a.ts/')).toBe('src/a.ts')
  })

  it('returns undefined when nothing matches', () => {
    expect(matchReviewFile(files, 'src/other.ts')).toBeUndefined()
    expect(matchReviewFile(files, '')).toBeUndefined()
  })
})
