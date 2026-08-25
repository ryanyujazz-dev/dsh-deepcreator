// @vitest-environment jsdom
/**
 * Sandbox data bridge relay tests: protocol v1 handshake, the three data
 * ops against a remote double, source-frame validation, and unsubscribe.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStageBridge } from '../src/client/bridge.ts'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'

type Listener = (event: MessageEvent) => void

/** Minimal frame double: contentWindow with a message sink. */
function frameDouble(): { frame: HTMLIFrameElement; posted: unknown[]; receive: (data: unknown) => void } {
  const listeners: Listener[] = []
  const posted: unknown[] = []
  const contentWindow = { postMessage: (data: unknown): void => { posted.push(data) } }
  const frame = { contentWindow } as unknown as HTMLIFrameElement
  const receive = (data: unknown): void => {
    for (const listener of [...listeners]) listener({ source: contentWindow, data } as MessageEvent)
  }
  const realAdd = window.addEventListener.bind(window)
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'message') listeners.push(listener as Listener)
    return realAdd(type, listener)
  }) as typeof window.addEventListener)
  return { frame, posted, receive }
}

afterEach(() => { vi.restoreAllMocks() })

const session = (): SessionId => 's-1' as never as SessionId

function remoteDouble() {
  const doc = new Map<string, unknown>([['count', 1]])
  const journal: Array<{ rev: number; path: string; value: unknown; causeId: string; ts: string }> = [
    { rev: 1, path: 'count', value: 1, causeId: 'seed', ts: 't0' },
  ]
  let rev = 1
  return {
    doc,
    journal,
    dataGet: vi.fn(async (_s: never, _ref: string, path?: string) => ({
      ok: true as const,
      value: { ok: true as const, value: path === undefined ? Object.fromEntries(doc) : doc.get(path), rev },
    })),
    dataSet: vi.fn(async (_s: never, _ref: string, path: string, value: unknown) => {
      doc.set(path, value)
      rev += 1
      journal.push({ rev, path, value, causeId: 'ui-test', ts: 't1' })
      return { ok: true as const, value: { ok: true as const, rev } }
    }),
    dataChanges: vi.fn(async (_s: never, _ref: string, sinceRev: number) => ({
      ok: true as const,
      value: { ok: true as const, changes: journal.filter(entry => entry.rev > sinceRev), rev },
    })),
  }
}

describe('sandbox data bridge (protocol v1)', () => {
  it('answers data.get with the value and rev, carrying proto 1', async () => {
    const { frame, posted, receive } = frameDouble()
    const remote = remoteDouble()
    const attach = createAppStageBridge({ remote: remote as never, session })
    const detach = attach(frame, 'dev:kanban')
    receive({ __appStage: 1, id: 'q1', op: 'data.get', path: 'count' })
    await vi.waitFor(() => { expect(posted.length).toBeGreaterThan(0) })
    const reply = posted.at(-1) as { __appStage: number; proto: number; id: string; ok: boolean; value: unknown; rev: number }
    expect(reply).toMatchObject({ __appStage: 1, proto: 1, id: 'q1', ok: true, value: 1 })
    detach()
  })

  it('rejects an unsupported protocol number with PROTOCOL_UNSUPPORTED (handshake)', async () => {
    const { frame, posted, receive } = frameDouble()
    const attach = createAppStageBridge({ remote: remoteDouble() as never, session })
    const detach = attach(frame, 'dev:kanban')
    receive({ __appStage: 2, id: 'q2', op: 'data.get' })
    await vi.waitFor(() => { expect(posted.length).toBeGreaterThan(0) })
    expect(posted.at(-1)).toMatchObject({ ok: false, error: { code: 'PROTOCOL_UNSUPPORTED' } })
    detach()
  })

  it('writes through data.set and echoes the journal event down', async () => {
    const { frame, posted, receive } = frameDouble()
    const remote = remoteDouble()
    const attach = createAppStageBridge({ remote: remote as never, session })
    const detach = attach(frame, 'dev:kanban')
    receive({ __appStage: 1, id: 'q3', op: 'data.set', path: 'count', value: 7 })
    await vi.waitFor(() => {
      const setReply = posted.find(message => (message as { id?: string }).id === 'q3')
      expect(setReply).toMatchObject({ ok: true })
    })
    expect(remote.dataSet).toHaveBeenCalledWith('s-1', 'dev:kanban', 'count', 7, expect.stringMatching(/^ui-/))
    await vi.waitFor(() => {
      const event = posted.find(message => (message as { op?: string }).op === 'data.event')
      expect(event).toBeDefined()
    })
    detach()
  })

  it('ignores messages whose source is not the attached frame', async () => {
    const { frame, posted } = frameDouble()
    const attach = createAppStageBridge({ remote: remoteDouble() as never, session })
    const detach = attach(frame, 'dev:kanban')
    // A message from some other window (source mismatch) never reaches the relay.
    window.dispatchEvent(new MessageEvent('message', { data: { __appStage: 1, id: 'evil', op: 'data.get' }, source: {} as MessageEventSource }))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(posted).toEqual([])
    detach()
  })

  it('unsubscribes cleanly and stops polling', async () => {
    vi.useFakeTimers()
    try {
      const { frame, posted, receive } = frameDouble()
      const remote = remoteDouble()
      const attach = createAppStageBridge({ remote: remote as never, session })
      const detach = attach(frame, 'dev:kanban')
      receive({ __appStage: 1, id: 'q4', op: 'data.subscribe', sinceRev: 0 })
      await vi.advanceTimersByTimeAsync(10)
      const callsAfterSubscribe = remote.dataChanges.mock.calls.length
      receive({ __appStage: 1, id: 'q5', op: 'data.unsubscribe' })
      await vi.advanceTimersByTimeAsync(4000)
      expect(remote.dataChanges.mock.calls.length).toBe(callsAfterSubscribe)
      expect(posted.at(-1)).toMatchObject({ id: 'q5', ok: true })
      detach()
    } finally {
      vi.useRealTimers()
    }
  })
})
