// @vitest-environment jsdom
// ReviewCacheController: the session Review data plane — sequential
// visibility-gated near-viewport prefetch, event-driven invalidation from the
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
      summary: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', scope: 'uncommitted',
          additions: files.length, deletions: files.length,
          files: files.map(path => ({ path, additions: 1, deletions: 1, binary: false })),
        },
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
      history: vi.fn().mockResolvedValue({
        ok: true, value: { ok: true, repositoryRoot: '/workspace', turns: [] },
      }),
      undoTurn: vi.fn().mockResolvedValue({
        ok: true, value: { ok: true, repositoryRoot: '/workspace', turn: 1, revertedFiles: [] },
      }),
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
  it('keeps bodies cold while hidden, then prefetches visible top files sequentially', async () => {
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
    expect(remote.review.diff).not.toHaveBeenCalled()
    cache.setVisible(true)
    await flush()
    // Strictly one in flight: b waits for a.
    expect(remote.review.status).toHaveBeenCalledWith(SID, 'uncommitted')
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
    cache.setVisible(true)
    await flush(); await flush(); await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['f1.ts', 'f2.ts'])
    cache.ensure('f3.ts')
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['f1.ts', 'f2.ts', 'f3.ts'])
    cache.dispose()
  })

  it('queues multiple viewport ensures through the sequential drain, never concurrently', async () => {
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
    // A batch gesture uses the same sequential drain instead of firing
    // concurrent fetches. Hidden panels do not enqueue idle work.
    await flush()
    cache.ensure('b.ts'); cache.ensure('c.ts'); cache.ensure('d.ts')
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['b.ts'])
    gates[0]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['b.ts', 'c.ts'])
    // Ready entries are untouched by a repeat batch.
    cache.ensure('a.ts'); cache.ensure('b.ts'); cache.ensure('c.ts'); cache.ensure('d.ts')
    gates[1]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['b.ts', 'c.ts', 'd.ts'])
    gates[2]?.()
    await flush()
    expect(remote.review.diff.mock.calls.map(call => call[1])).toEqual(['b.ts', 'c.ts', 'd.ts', 'a.ts'])
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
    cache.setVisible(true)
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
    cache.setVisible(true)
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

  it('defers turn-end checks through invisibility until the panel becomes visible', async () => {
    const feed = sessionStub()
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: feed.session })
    await flush(); await flush(); await flush()
    expect(remote.review.checks).not.toHaveBeenCalled()

    const ended = emptyChat()
    ended.turnEnds = new Map([[1, 9]])
    feed.publish(ended)
    await flush(); await flush()
    expect(remote.review.checks).not.toHaveBeenCalled()
    cache.setVisible(true)
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
    expect(remote.review.diff).toHaveBeenLastCalledWith(SID, 'src/b.ts', 'uncommitted')
    cache.dispose()
  })

  it('switches to a historical turn as provider-defined scope and shares its history cache', async () => {
    const remote = remoteMock(['src/a.ts'])
    remote.review.history.mockResolvedValue({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace',
        turns: [{
          turn: 9, totalFiles: 1, remainingFiles: 1, state: 'active', undoable: true,
          files: [{ path: 'src/a.ts', state: 'pending' }],
        }],
      },
    })
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush()
    expect(cache.getSnapshot().history?.turns[0]?.turn).toBe(9)

    await cache.selectScope({ turn: 9 }, '/workspace/src/a.ts')
    await flush()
    expect(cache.getSnapshot().scope).toEqual({ turn: 9 })
    expect(remote.review.status).toHaveBeenLastCalledWith(SID, { turn: 9 })
    expect(remote.review.diff).toHaveBeenLastCalledWith(SID, 'src/a.ts', { turn: 9 })
    cache.dispose()
  })

  it('hydrates missing counts from historical diffs served by an older host', async () => {
    const remote = remoteMock(['src/a.ts'])
    remote.review.summary.mockRejectedValue(new Error('unknown remote method'))
    remote.review.history.mockResolvedValue({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', head: 'head-1',
        turns: [{
          turn: 8, totalFiles: 1, remainingFiles: 1, state: 'active', undoable: true,
          files: [{ path: 'src/a.ts', state: 'pending' }],
        }],
      },
    })
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })

    await flush(); await flush(); await flush()
    expect(remote.review.diff).toHaveBeenCalledWith(SID, 'src/a.ts', { turn: 8 })
    expect(cache.getSnapshot().history?.turns[0]).toMatchObject({
      additions: 1,
      deletions: 1,
      files: [{ path: 'src/a.ts', additions: 1, deletions: 1 }],
    })
    cache.dispose()
  })

  it('clears a selected historical turn as soon as its changes are committed', async () => {
    const remote = remoteMock(['src/a.ts'])
    remote.review.history.mockResolvedValue({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', head: 'before',
        turns: [{
          turn: 9, totalFiles: 1, remainingFiles: 1, state: 'active', undoable: true,
          files: [{ path: 'src/a.ts', state: 'pending' }],
        }],
      },
    })
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush()
    await cache.selectScope({ turn: 9 })
    await flush()
    expect(cache.getSnapshot().scope).toEqual({ turn: 9 })
    expect(Object.keys(cache.getSnapshot().entries)).toEqual(['src/a.ts'])

    remote.review.status.mockResolvedValue({
      ok: true,
      value: { ok: true, repositoryRoot: '/workspace', branch: 'main', scope: 'uncommitted', files: [] },
    })
    remote.review.history.mockResolvedValue({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', head: 'after',
        turns: [],
      },
    })

    await expect(cache.refreshHistory()).resolves.toBe(true)
    expect(cache.getSnapshot().scope).toBe('uncommitted')
    expect(cache.getSnapshot().entries).toEqual({})
    await flush()
    expect(remote.review.status).toHaveBeenLastCalledWith(SID, 'uncommitted')
    expect(cache.getSnapshot().status?.files).toEqual([])
    cache.dispose()
  })

  it('distinguishes a superseded focus refresh from a real missing file', async () => {
    const remote = remoteMock(['src/a.ts'])
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush()

    let releaseFirst: ((value: unknown) => void) | undefined
    remote.review.status
      .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
      .mockResolvedValueOnce({
        ok: true,
        value: {
          ok: true, repositoryRoot: '/workspace', branch: 'main',
          files: [{ path: 'src/a.ts', index: ' ', workingTree: 'M' }],
        },
      })
    const stale = cache.selectScope('staged', '/workspace/src/a.ts')
    const current = cache.selectScope('uncommitted', '/workspace/src/a.ts')

    await expect(current).resolves.toEqual({ kind: 'found', path: 'src/a.ts' })
    releaseFirst?.({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace', branch: 'main',
        files: [{ path: 'src/a.ts', index: ' ', workingTree: 'M' }],
      },
    })
    await expect(stale).resolves.toEqual({ kind: 'superseded' })
    cache.dispose()
  })

  it('surfaces a user-selected scope failure instead of reporting a missing file', async () => {
    const remote = remoteMock(['src/a.ts'])
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush()
    remote.review.status.mockRejectedValueOnce(new Error('status unavailable'))

    await expect(cache.selectScope('staged', '/workspace/src/a.ts')).resolves.toEqual({
      kind: 'error', message: 'status unavailable',
    })
    expect(cache.getSnapshot().error).toBe('status unavailable')
    expect(cache.getSnapshot().status).toBeNull()
    cache.dispose()
  })

  it('refreshes turn history before routing a chat file click', async () => {
    const remote = remoteMock(['src/a.ts'])
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush()

    let release: ((value: unknown) => void) | undefined
    remote.review.history.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    let settled = false
    const resolution = cache.resolveTurnFile(12, '/workspace/src/a.ts').then(value => {
      settled = true
      return value
    })
    await flush()
    expect(settled).toBe(false)
    release?.({
      ok: true,
      value: {
        ok: true, repositoryRoot: '/workspace',
        turns: [{
          turn: 12, totalFiles: 1, remainingFiles: 1, state: 'active', undoable: true,
          files: [{ path: 'src/a.ts', state: 'pending' }],
        }],
      },
    })

    await expect(resolution).resolves.toBe('pending')
    cache.dispose()
  })

  it('notifies only the changed file subscription when one body finishes', async () => {
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    cache.setVisible(true)
    await flush(); await flush(); await flush()
    const a = vi.fn()
    const b = vi.fn()
    const unsubscribeA = cache.subscribeFile('src/a.ts', a)
    const unsubscribeB = cache.subscribeFile('src/b.ts', b)

    cache.ensure('src/a.ts', 'focus', true)
    await flush(); await flush()

    expect(a).toHaveBeenCalled()
    expect(b).not.toHaveBeenCalled()
    unsubscribeA(); unsubscribeB(); cache.dispose()
  })

  it('does not publish structurally unchanged history polls', async () => {
    const remote = remoteMock()
    const cache = new ReviewCacheController({ remote: remote as never, sessionId: SID, session: sessionStub().session })
    await flush(); await flush()
    const listener = vi.fn()
    const unsubscribe = cache.subscribeHistory(listener)

    await cache.refreshHistory(true)

    expect(listener).not.toHaveBeenCalled()
    unsubscribe(); cache.dispose()
  })
})
