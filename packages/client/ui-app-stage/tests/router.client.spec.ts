// @vitest-environment jsdom
/**
 * Bridge protocol v2 (the action channel) and the Stage router: handler
 * registration drains parked waiters, action.invoke round-trips through the
 * frame's same-id reply, and the router executes a host-queued invoke end to
 * end (ensure → mount → register → dispatch → routerResult) against a stub
 * remote.
 * @module @ryanyujazz/dsh-client-ui-app-stage/tests/router.client.spec
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { createAppStageBridge, type BridgeHandle } from '../src/client/bridge.ts'
import { createStageRouter } from '../src/client/router.ts'
import type { AppStageRemote } from '../src/client/contract.ts'
import type { AppRouterRequest, AppStageEnsureResult } from '@ryanyujazz/dsh-app-stage/types'

afterEach(cleanup)

/** A real iframe whose contentWindow answers postMessage with a scripted reply. */
function frameWith(script: (message: Record<string, unknown>) => void): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  const target = frame.contentWindow!
  const original = target.postMessage.bind(target)
  vi.spyOn(target, 'postMessage').mockImplementation((message: unknown) => {
    void original(message, '*')
    if (typeof message === 'object' && message !== null) script(message as Record<string, unknown>)
  })
  return frame
}

/** Deliver a message from the frame into the shell's window listener. */
const fromFrame = (frame: HTMLIFrameElement, data: Record<string, unknown>): void => {
  window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow }))
}

const remoteFace = (): AppStageRemote & {
  waitMock: ReturnType<typeof vi.fn>
  resultMock: ReturnType<typeof vi.fn>
  ensureMock: ReturnType<typeof vi.fn>
} => {
  const ensureEntry = { appId: 'kanban-demo', status: 'ready', manifest: { id: 'kanban-demo', platform: 'app-stage-v1' as const, name: '看板演示', version: '0.1.0', entry: 'index.html', dev: false, actions: [], permissions: [] }, pointer: { version: '0.1.0' } }
  const ensure: AppStageEnsureResult = { ok: true, url: '/installed/kanban-demo/0.1.0/index.html', entry: ensureEntry as never }
  const remote: AppStageRemote = {
    list: vi.fn(async () => ({ ok: true, value: { ok: true, list: { installed: [], dev: [] } } })),
    ensure: vi.fn(async () => ({ ok: true, value: ensure })),
    dataGet: vi.fn(async () => ({ ok: true, value: { ok: true, value: null, rev: 0 } })),
    dataSet: vi.fn(async () => ({ ok: true, value: { ok: true, rev: 1 } })),
    dataChanges: vi.fn(async () => ({ ok: true, value: { ok: true, changes: [], rev: 0 } })),
    uninstall: vi.fn(async () => ({ ok: true, value: { ok: true, appId: 'x', removed: true } })),
    waitRouterRequests: vi.fn(async (_session: unknown, _cursor: number, _routerId: string) => ({ ok: true, value: { ok: true, requests: [], cursor: 0 } })),
    routerResult: vi.fn(async () => ({ ok: true, value: { ok: true, requestId: 'r1' } })),
  }
  return remote as AppStageRemote & { waitMock: ReturnType<typeof vi.fn>; resultMock: ReturnType<typeof vi.fn>; ensureMock: ReturnType<typeof vi.fn> }
}

describe('bridge v2 — the action channel', () => {
  it('records action registrations and drains parked waiters', async () => {
    const bridge = createAppStageBridge({ remote: remoteFace(), session: () => 's1' as never })
    const frame = frameWith(() => {})
    const handle = bridge(frame, 'kanban-demo')
    const waiting = handle.waitForAction('createTask', 50)
    fromFrame(frame, { __appStage: 1, id: 'reg-1', op: 'action.register', action: 'createTask' })
    await expect(waiting).resolves.toBeUndefined()
    expect(handle.actions.has('createTask')).toBe(true)
    handle()
    frame.remove()
  })

  it('round-trips action.invoke through the frame same-id reply', async () => {
    const bridge = createAppStageBridge({ remote: remoteFace(), session: () => 's1' as never })
    const frame = frameWith(message => {
      if (message['op'] === 'action.invoke') {
        queueMicrotask(() => fromFrame(frame, { __appStage: 1, proto: 2, id: message['id'], ok: true, result: { nodeId: 'n-7' } }))
      }
    })
    const handle: BridgeHandle = bridge(frame, 'kanban-demo')
    await expect(handle.invoke('place', { x: 0 }, 200)).resolves.toEqual({ ok: true, result: { nodeId: 'n-7' } })
    handle()
    frame.remove()
  })

  it('maps a handler error reply onto the failure envelope', async () => {
    const bridge = createAppStageBridge({ remote: remoteFace(), session: () => 's1' as never })
    const frame = frameWith(message => {
      if (message['op'] === 'action.invoke') {
        queueMicrotask(() => fromFrame(frame, { __appStage: 1, proto: 2, id: message['id'], ok: false, error: { message: 'bad payload' } }))
      }
    })
    const handle = bridge(frame, 'kanban-demo')
    await expect(handle.invoke('place', {}, 200)).resolves.toEqual({ ok: false, message: 'bad payload' })
    handle()
    frame.remove()
  })
})

/** Simulate the shell's mount duty: whenever the router store shows a
 * container, mount a frame and bind it — exactly what StageShell's callback
 * ref does. One container at a time; a swap detaches first. */
function mountShell(router: ReturnType<typeof createStageRouter>): void {
  let bound: { ref: string; frame: HTMLIFrameElement; detach: () => void } | undefined
  router.subscribe(() => {
    const next = router.getSnapshot()
    if (next === undefined) {
      bound?.detach()
      bound?.frame.remove()
      bound = undefined
      return
    }
    if (bound !== undefined && bound.ref === next.ref) return
    bound?.detach()
    bound?.frame.remove()
    const frame = frameWith(() => {})
    const detach = router.bindFrame(next.ref, frame)
    bound = { ref: next.ref, frame, detach }
  })
}

describe('Stage router — end-to-end request execution', () => {
  it('executes a queued invoke: ensure, mount, register, dispatch, report', async () => {
    const remote = remoteFace()
    const request: AppRouterRequest = { kind: 'invoke', requestId: 'r1', appId: 'kanban-demo', version: '0.1.0', action: 'createTask', params: { title: 'x' } }
    let deliverRequests: (requests: AppRouterRequest[]) => void = () => {}
    ;(remote.waitRouterRequests as ReturnType<typeof vi.fn>).mockImplementation(async () => new Promise(resolve => {
      deliverRequests = requests => { deliverRequests = () => {}; resolve({ ok: true, value: { ok: true, requests, cursor: 1 } }) }
    }))
    const activity: Array<{ appId: string; name: string } | undefined> = []
    // The bridge factory doubles as the installed app: register the action,
    // answer invokes by same-id reply.
    const bridgeFactory = (frame: HTMLIFrameElement): BridgeHandle => {
      const handle = createAppStageBridge({ remote, session: () => 's1' as never })(frame, 'kanban-demo')
      fromFrame(frame, { __appStage: 1, id: 'reg-1', op: 'action.register', action: 'createTask' })
      const target = frame.contentWindow!
      vi.spyOn(target, 'postMessage').mockImplementation((message: unknown) => {
        if (typeof message === 'object' && (message as Record<string, unknown>)['op'] === 'action.invoke') {
          const typed = message as Record<string, unknown>
          queueMicrotask(() => fromFrame(frame, { __appStage: 1, proto: 2, id: typed['id'], ok: true, result: { created: true } }))
        }
      })
      return handle
    }
    const router = createStageRouter({
      remote,
      session: () => 's1' as never,
      onActivity: value => { activity.push(value) },
      onPresent: () => {},
    }, bridgeFactory)
    mountShell(router)
    void router.poll()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    deliverRequests([request])
    await vi.waitFor(() => { expect(remote.routerResult).toHaveBeenCalled() })
    expect(remote.routerResult).toHaveBeenCalledWith('s1', 'r1', { result: { created: true } })
    expect(remote.ensure).toHaveBeenCalledWith('s1', 'kanban-demo')
    expect(activity.at(-1)).toBeUndefined()
    expect(activity.some(item => item?.appId === 'kanban-demo')).toBe(true)
  })

  it('reports ACTION_NOT_REGISTERED when the frame never registers the action', { timeout: 15_000 }, async () => {
    const remote = remoteFace()
    const request: AppRouterRequest = { kind: 'invoke', requestId: 'r1', appId: 'kanban-demo', version: '0.1.0', action: 'missing', params: {} }
    let deliverRequests: (requests: AppRouterRequest[]) => void = () => {}
    ;(remote.waitRouterRequests as ReturnType<typeof vi.fn>).mockImplementation(async () => new Promise(resolve => {
      deliverRequests = requests => { deliverRequests = () => {}; resolve({ ok: true, value: { ok: true, requests, cursor: 1 } }) }
    }))
    const router = createStageRouter({
      remote,
      session: () => 's1' as never,
      onActivity: () => {},
      onPresent: () => {},
    }, frame => createAppStageBridge({ remote, session: () => 's1' as never })(frame, 'kanban-demo'))
    mountShell(router)
    void router.poll()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    deliverRequests([request])
    await vi.waitFor(() => { expect(remote.routerResult).toHaveBeenCalled() }, { timeout: 12_000 })
    expect(remote.routerResult).toHaveBeenCalledWith('s1', 'r1', { error: { code: 'ACTION_NOT_REGISTERED', message: expect.stringContaining('missing') } })
  })

  it('user opens and closes through the router store', () => {
    const remote = remoteFace()
    const router = createStageRouter({ remote, session: () => undefined, onActivity: () => {}, onPresent: () => {} }, () => (() => {}) as unknown as BridgeHandle)
    expect(router.getSnapshot()).toBeUndefined()
    router.openFromUser({ appId: 'kanban-demo', name: '看板演示', version: '0.1.0', url: '/x', dev: false, ref: 'kanban-demo' })
    expect(router.getSnapshot()?.appId).toBe('kanban-demo')
    router.close()
    expect(router.getSnapshot()).toBeUndefined()
  })
})
