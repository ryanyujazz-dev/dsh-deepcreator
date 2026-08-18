// @vitest-environment jsdom
// ReviewCacheController: the session Review data plane — sequential
// background prefetch from session entry, event-driven invalidation from the
// session snapshot, turn-end checks policy, visibility catch-all, and
// parse-reference reuse on identical revalidates.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationNode, ConversationSnapshot, SessionId, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { ReviewCacheController } from '../src/client/review-cache.ts'

afterEach(() => { vi.useRealTimers() })
beforeEach(() => { localStorage.clear() })

const SID = 'session-1' as SessionId

const emptyChat = (): ConversationSnapshot => ({ nodes: [], turnEnds: new Map() }) as unknown as ConversationSnapshot

const editResult = (seq: number, callId: string, path: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000, callId,
  call: { name: 'edit', argsRaw: `{"file_path":"${path}","old_string":"a","new_string":"b"}` },
  callTime: seq * 1_000 - 1, content: [], isError: false, callView: null, resultView: null, subCalls: [],
})

const patch = (path: string): string => [
  `diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, '@@ -1 +1 @@', '-a', '+b',
].join('\n')

/** A controllable ObservableSnapshot session feed. */
function sessionStub(initial: ConversationSnapshot = emptyChat()) {
  const listeners = new Set<() => void>()
  let current = initial
  return {
    session: {
      subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
      getSnapshot: () => current,
    },
    publish(next: ConversationSnapshot): void {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

function remoteMock(files: string[] = ['src/a.ts', 'src/b.ts']) {
  return {
    review: {
      status: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', branch: 'main',
          files: files.map(path => ({ path, index: ' ', workingTree: 'M' })),
        },
      }),
      checks: vi.fn().mockResolvedValue({
        ok: true, value: { ok: true, repositoryRoot: '/workspace', clean: true, output: '' },
      }),
      diff: vi.fn(async (_sessionId: string, path: string) => ({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', path,
          layers: [{
            kind: 'working-tree', patch: patch(path),
            oldSource: { revision: 'index', text: 'a' },
            newSource: { revision: 'worktree', text: 'b' },
          }],
        },
      })),
    },
  }
}

/** Several macro-task turns: the drain yields once per file, so one flush
 *  alone cannot advance past a completed load plus its yield. */
const flush = async (): Promise<void> => {
  for (let index = 0; index < 3; index += 1) await new Promise(resolve => { setTimeout(resolve, 0) })
}

/** Same under fake timers: enough 0 ms turns for prefetch loads + yields. */
const advance = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) await vi.advanceTimersByTimeAsync(0)
}

describe('ReviewCacheController', () => {
  it('prefetches every file sequentially in the background on session entry', async () => {
    const remote = remoteMock()
    const gates: Array<() => void> = []
    remote.review.diff = vi.fn((_sid: string, path: string) => new Promise(resolve => {
      gates.push(() => resolve({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', path,
          layers: [{
            kind: 'working-tree', patch: patch(path),
            oldSource: { revision: 'index', text: 'a' },
            newSource: { revision: 'worktree', text: 'b' },
          }],
        },
      }))
    })) as never
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })

    await flush()
    // Strictly one in flight: b waits for a.
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['src/a.ts'])
    gates[0]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['src/a.ts', 'src/b.ts'])
    gates[1]?.()
    await flush()
    expect(cache.getSnapshot().entries['src/a.ts']?.cache.kind).toBe('ready')
    expect(cache.getSnapshot().entries['src/b.ts']?.cache.kind).toBe('ready')
    // Checks stay reserved for manual refresh and turn ends.
    expect(remote.review.checks).not.toHaveBeenCalled()
    cache.dispose()
  })

  it('caps the background prefetch and still fetches beyond the cap on demand', async () => {
    const files = ['f1.ts', 'f2.ts', 'f3.ts']
    const remote = remoteMock(files)
    const cache = new ReviewCacheController({
      remote: remote as never, sessionId: SID, session: sessionStub().session, prefetchLimit: 2,
    })
    await flush(); await flush(); await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['f1.ts', 'f2.ts'])
    cache.ensure('f3.ts')
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['f1.ts', 'f2.ts', 'f3.ts'])
    cache.dispose()
  })

  it('loadAll queues batch gestures through the sequential drain, never concurrently', async () => {
    const gates: Array<() => void> = []
    const remote = remoteMock(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    remote.review.diff = vi.fn((_sid: string, path: string) => new Promise(resolve => {
      gates.push(() => resolve({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', path,
          layers: [{
            kind: 'working-tree', patch: patch(path),
            oldSource: { revision: 'index', text: 'a' },
            newSource: { revision: 'worktree', text: 'b' },
          }],
        },
      }))
    })) as never
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    // The entry prefetch holds the first gate; the batch gesture appends to
    // the same queue instead of firing its own concurrent fetches.
    await flush()
    cache.loadAll(['b.ts', 'c.ts', 'd.ts'])
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['a.ts'])
    gates[0]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['a.ts', 'b.ts'])
    // Ready entries are untouched by a repeat batch.
    cache.loadAll(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    gates[1]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['a.ts', 'b.ts', 'c.ts'])
    gates[2]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'])
    gates[3]?.()
    await flush()
    expect(cache.getSnapshot().entries['d.ts']?.cache.kind).toBe('ready')
    expect(remote.review.diff.mock.calls).toHaveLength(4)
    cache.dispose()
  })

  it('revalidates only the targeted file after a settled edit, debounced', async () => {
    vi.useFakeTimers()
    const feed = sessionStub()
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: feed.session })
    await advance()
    expect(remote.review.diff).toHaveBeenCalledTimes(2)

    const mutated = emptyChat()
    mutated.nodes = [editResult(7, 'c7', 'src/a.ts')] as ConversationNode[]
    feed.publish(mutated)
    await vi.advanceTimersByTimeAsync(700)

    expect(remote.review.status).toHaveBeenCalledTimes(2)
    const calls = remote.review.diff.mock.calls.map(call => call[1])
    expect(calls.filter(path => path === 'src/a.ts')).toHaveLength(2)
    expect(calls.filter(path => path === 'src/b.ts')).toHaveLength(1)
    cache.dispose()
  })

  it('reuses the parse object when a revalidate returns identical content', async () => {
    vi.useFakeTimers()
    const feed = sessionStub()
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: feed.session })
    await advance()
    const before = cache.getSnapshot().entries['src/a.ts']?.cache
    expect(before?.kind).toBe('ready')

    const mutated = emptyChat()
    mutated.nodes = [editResult(7, 'c7', 'src/a.ts')] as ConversationNode[]
    feed.publish(mutated)
    await vi.advanceTimersByTimeAsync(700)

    const after = cache.getSnapshot().entries['src/a.ts']?.cache
    expect(after).toBe(before)
    cache.dispose()
  })

  it('runs checks when a turn ends, deferring them through invisibility', async () => {
    const feed = sessionStub()
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: feed.session })
    await flush(); await flush(); await flush()
    expect(remote.review.checks).not.toHaveBeenCalled()

    const ended = emptyChat()
    ended.turnEnds = new Map([[1, 9]])
    feed.publish(ended)
    await flush(); await flush()
    expect(remote.review.checks).toHaveBeenCalledTimes(1)
    cache.dispose()
  })

  it('refreshes silently on the hidden→visible edge', async () => {
    const feed = sessionStub()
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: feed.session })
    await flush(); await flush(); await flush()
    expect(remote.review.status).toHaveBeenCalledTimes(1)

    cache.setVisible(false)
    cache.setVisible(true)
    await flush(); await flush()
    expect(remote.review.status).toHaveBeenCalledTimes(2)
    // Unchanged status keeps every cache: no refetch.
    expect(remote.review.diff).toHaveBeenCalledTimes(2)
    cache.dispose()
  })

  it('focus fetch (reveal) jumps the queue with fresh content', async () => {
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush(); await flush()
    const before = remote.review.diff.mock.calls.length

    void cache.refresh({ focusPath: '/workspace/src/b.ts', silent: true })
    await flush(); await flush()
    expect(remote.review.status).toHaveBeenCalledTimes(2)
    expect(remote.review.diff.mock.calls.length).toBeGreaterThan(before)
    expect(remote.review.diff).toHaveBeenLastCalledWith(SID, 'src/b.ts')
    cache.dispose()
  })
})
