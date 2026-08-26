/**
 * The Stage router — the client executor of the M4 operation face.
 *
 * `app_invoke` / `app_open` arrive as host-queued requests through the
 * official long-poll remote (`waitRouterRequests`, the
 * `browser-runtime.waitStateRevision` idiom — the forwarded-event allowlist
 * is a frozen const, so push events are not a plugin option). This router
 * executes each one against the one live Stage container: ensure the
 * container is mounted (the apps seat stays physically mounted even while
 * hidden, so an app can be driven from conversation mode without switching
 * the user's view), wait for the frame to register the declared action, and
 * dispatch through the bridge's v2 channel. Results return via
 * `routerResult`; failures carry machine codes the service maps onto the
 * frozen error vocabulary.
 *
 * The router also owns the container store the shell renders from — user
 * clicks (launcher card, dev menu) and agent requests converge on one
 * source of truth, so an agent-driven open and a user click can never
 * diverge.
 * @module @ryanyujazz/dsh-client-ui-app-stage/client/router
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { AppJsonValue, AppRouterOutcome, AppRouterRequest } from '@ryanyujazz/dsh-app-stage/types'
import type { BridgeHandle } from './bridge.ts'
import type { AppStageRemote, OpenContainer } from './contract.ts'

/** How long a cold frame gets to register the invoked action. */
export const ACTION_REGISTER_WAIT_MS = 10_000

/** One dispatch ceiling inside the router (the service ceiling is 30 s). */
export const ROUTER_INVOKE_TIMEOUT_MS = 25_000

/** The shell-facing API surface of the router (store + frame binding). */
export interface StageRouterApi {
  /** Live container store (the shell renders through useSyncExternalStore). */
  subscribe(listener: () => void): () => void
  getSnapshot(): OpenContainer | undefined
  /** Open a container from user intent (launcher card, dev menu row). */
  openFromUser(container: OpenContainer): void
  /** Close the container (back-to-desktop button). */
  close(): void
  /** Bind the live frame the shell mounted for `ref`; returns detach. */
  bindFrame(ref: string, frame: HTMLIFrameElement): () => void
  /** Kick the long-poll loop (session arrival, after a user open). */
  poll(): void
}

/** The environment the router needs (captured faces, never ctx). */
export interface RouterEnv {
  readonly remote: AppStageRemote
  readonly session: () => SessionId | undefined
  /** Activity signal: set while an agent request drives an app. */
  readonly onActivity: (activity: { appId: string; name: string } | undefined) => void
  /** Presentation write-back: app_open focus switches the user's view. */
  readonly onPresent: (focus: boolean) => void
}

interface FrameSlot {
  readonly frame: HTMLIFrameElement
  readonly handle: BridgeHandle
}

/**
 * Create the router. The long-poll loop starts when a session exists and
 * stops with `dispose()`; requests that arrive while no session is bound
 * wait host-side under their own ceilings.
 */
export function createStageRouter(env: RouterEnv, bridge: (frame: HTMLIFrameElement, ref: string) => BridgeHandle): StageRouterApi {
  let container: OpenContainer | undefined
  const listeners = new Set<() => void>()
  const frames = new Map<string, FrameSlot>()
  const mountWaiters = new Set<(slot: FrameSlot | undefined) => void>()
  let disposed = false
  let polling = false
  let cursor = 0

  const emit = (): void => { for (const listener of [...listeners]) listener() }

  const setContainer = (next: OpenContainer | undefined): void => {
    container = next
    emit()
  }

  /** Resolve the frame slot bound for `ref`: an already-bound frame wins
   * immediately (the shell's callback ref fires synchronously inside the
   * store emit — before this park in the cold-start path), otherwise park
   * for the next bind. */
  const waitForFrame = (ref: string, timeoutMs: number): Promise<FrameSlot | undefined> => new Promise(resolve => {
    const existing = frames.get(ref)
    if (existing !== undefined) { resolve(existing); return }
    let done = false
    const finish = (slot: FrameSlot | undefined): void => {
      if (done) return
      done = true
      mountWaiters.delete(finish)
      clearTimeout(timer)
      resolve(slot)
    }
    const timer = setTimeout(() => finish(undefined), timeoutMs)
    mountWaiters.add(finish)
  })

  /** Ensure the container for `appId` is mounted (swap semantics: one
   * container; AppData is the single source of truth, so a swap reloads
   * rather than corrupts). Resolves the live frame slot. */
  const ensureContainer = async (appId: string): Promise<{ ok: true; slot: FrameSlot; opened: boolean } | { ok: false; message: string }> => {
    const opened = container === undefined || container.appId !== appId || container.dev
    if (!opened) {
      const slot = frames.get(container!.ref)
      if (slot !== undefined) return { ok: true, slot, opened: false }
    }
    const session = env.session()
    if (session === undefined) return { ok: false, message: 'no current session to resolve the app URL' }
    // The installed facts come from the ensure re-gate (it also clears the
    // launcher's blue-dot watermark, exactly like a user open).
    const wire = await env.remote.ensure(session, appId)
    if (!wire.ok) return { ok: false, message: wire.error.message }
    if (!wire.value.ok) return { ok: false, message: `${wire.value.code}: ${wire.value.message}` }
    const entry = wire.value.entry
    const manifest = 'actions' in entry ? entry.manifest : undefined
    const pointer = 'pointer' in entry && entry.pointer !== undefined ? entry.pointer : undefined
    const name = manifest?.name ?? appId
    const version = pointer?.version ?? manifest?.version ?? ''
    setContainer({ appId, name, version, url: wire.value.url, dev: false, ref: appId })
    const slot = await waitForFrame(appId, 8_000)
    if (slot === undefined) return { ok: false, message: 'the container frame did not mount in time' }
    return { ok: true, slot, opened: true }
  }

  const handleInvoke = async (request: AppRouterRequest): Promise<AppRouterOutcome> => {
    const ensured = await ensureContainer(request.appId)
    if (!ensured.ok) return { error: { code: 'CONTAINER_UNAVAILABLE', message: ensured.message } }
    try {
      await ensured.slot.handle.waitForAction(request.action ?? '', ACTION_REGISTER_WAIT_MS)
    } catch {
      return { error: { code: 'ACTION_NOT_REGISTERED', message: `the app never registered "${request.action}"` } }
    }
    return ensured.slot.handle.invoke(request.action ?? '', (request.params ?? {}) as AppJsonValue, ROUTER_INVOKE_TIMEOUT_MS)
      .then(reply => {
        if (reply.ok) {
          return reply.result === undefined ? {} : { result: reply.result } as AppRouterOutcome
        }
        return { error: { message: reply.message } } as AppRouterOutcome
      })
  }

  const handleOpen = async (request: AppRouterRequest): Promise<AppRouterOutcome> => {
    const ensured = await ensureContainer(request.appId)
    if (!ensured.ok) return { error: { code: 'CONTAINER_UNAVAILABLE', message: ensured.message } }
    if (request.focus === true) env.onPresent(true)
    return { opened: ensured.opened, focused: request.focus === true }
  }

  const handleOne = async (request: AppRouterRequest): Promise<void> => {
    const session = env.session()
    if (session === undefined) return
    let outcome: AppRouterOutcome
    if (request.kind === 'invoke') {
      env.onActivity({ appId: request.appId, name: request.name ?? request.appId })
      try {
        outcome = await handleInvoke(request)
      } finally {
        env.onActivity(undefined)
      }
    } else {
      outcome = await handleOpen(request)
    }
    if (disposed) return
    await env.remote.routerResult(session, request.requestId, outcome).catch(() => { /* a dropped report settles host-side by timeout */ })
  }

  const poll = async (): Promise<void> => {
    if (disposed || polling) return
    const session = env.session()
    if (session === undefined) return
    polling = true
    try {
      const wire = await env.remote.waitRouterRequests(session, cursor)
      if (!wire.ok || !wire.value.ok) return
      cursor = wire.value.cursor
      for (const request of wire.value.requests) await handleOne(request)
    } catch {
      /* transport hiccup: the next cadence tick retries */
    } finally {
      polling = false
    }
    // Re-poll through a macrotask hop: a transport that resolves instantly
    // (mocks, cache-warm local calls) must not turn the loop into an
    // infinite microtask chain that starves timers and painting.
    if (!disposed) {
      window.setTimeout(() => {
        if (!disposed && !polling) void poll()
      }, 0)
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => container,
    openFromUser(next) {
      setContainer(next)
      void poll()
    },
    close() {
      setContainer(undefined)
    },
    poll() {
      void poll()
    },
    bindFrame(ref, frame) {
      const handle = bridge(frame, ref)
      const slot: FrameSlot = { frame, handle }
      frames.set(ref, slot)
      for (const waiter of [...mountWaiters]) waiter(slot)
      return () => {
        if (frames.get(ref) === slot) frames.delete(ref)
        handle()
      }
    },
  }
}

/** Start the router's poll loop whenever a session becomes available. The
 * returned disposer stops the loop and clears the activity signal. */
export function startRouterLoop(router: { poll(): void }, env: { session(): SessionId | undefined }): () => void {
  let last: SessionId | undefined
  const tick = (): void => {
    const current = env.session()
    if (current !== last) {
      last = current
      if (current !== undefined) router.poll()
    }
  }
  const interval = setInterval(tick, 1_000)
  tick()
  return () => clearInterval(interval)
}
