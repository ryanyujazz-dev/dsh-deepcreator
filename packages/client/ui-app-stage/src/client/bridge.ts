/**
 * The sandbox data bridge — the app side of `data.get/set/subscribe`.
 *
 * Protocol v1 (minimal subset + version handshake): the sandboxed app posts
 * `{__appStage: 1, id, op, ...}` to its parent; this relay answers every
 * request with a same-`id` reply carrying `proto: 1`. An unknown protocol
 * number gets one `PROTOCOL_UNSUPPORTED` error reply (the handshake); other
 * failures get `{error: {code, message}}` on the reply. Subscriptions poll
 * the journal face while the frame is alive and push `data.event` frames
 * down — key-path-level change events, so multi-instance broadcast comes
 * free once more than one container shares a document.
 *
 * The relay validates `event.source` against the attached frame's
 * contentWindow: messages from any other origin/frame are ignored. The
 * opaque-origin sandbox forbids targetOrigin narrowing, so replies go to the
 * frame itself with `'*'` (the id correlation and source check are the
 * trust boundary).
 * @module @ryanyujazz/dsh-client-ui-app-stage/client/bridge
 */
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { AppStageDataChangesResult, AppStageDataGetResult, AppStageDataSetResult, AppJsonValue } from '@ryanyujazz/dsh-app-stage/types'
import type { AppStageRemote } from './contract.ts'

/** Inbound frame → shell message (protocol v1 request face). */
export interface BridgeInbound {
  readonly __appStage: number
  readonly id: string
  readonly op: 'data.get' | 'data.set' | 'data.subscribe' | 'data.unsubscribe'
  readonly path?: string
  readonly value?: AppJsonValue
  readonly sinceRev?: number
}

/** One journal entry as the wire carries it down to the app. */
export interface BridgeChange {
  readonly rev: number
  readonly path: string
  readonly value: AppJsonValue
  readonly causeId: string
  readonly ts: string
}

/** Remote face slice the bridge needs (the shell's captured namespace). */
export type BridgeRemote = Pick<AppStageRemote, 'dataGet' | 'dataSet' | 'dataChanges'>

/** Reply/validation envelope posted down to the frame. */
export interface BridgeReply {
  readonly __appStage: number
  readonly proto: 1
  readonly id: string
  readonly op?: 'data.event'
  readonly ok: boolean
  readonly value?: AppJsonValue
  readonly rev?: number
  readonly changes?: readonly BridgeChange[]
  readonly error?: { code: string; message: string }
}

/** Subscription poll cadence while at least one subscriber is attached. */
export const BRIDGE_POLL_MS = 1500

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)

function parseInbound(data: unknown): BridgeInbound | undefined {
  if (!isRecord(data)) return undefined
  const proto = data['__appStage']
  if (typeof proto !== 'number') return undefined
  if (typeof data['id'] !== 'string' || data['id'] === '') return undefined
  if (typeof data['op'] !== 'string') return undefined
  if (proto !== 1) {
    return { __appStage: proto, id: data['id'], op: 'data.get' }
  }
  const op = data['op']
  if (op !== 'data.get' && op !== 'data.set' && op !== 'data.subscribe' && op !== 'data.unsubscribe') return undefined
  return {
    __appStage: 1,
    id: data['id'],
    op,
    ...(typeof data['path'] === 'string' ? { path: data['path'] } : {}),
    ...('value' in data ? { value: data['value'] as AppJsonValue } : {}),
    ...(typeof data['sinceRev'] === 'number' ? { sinceRev: data['sinceRev'] } : {}),
  }
}

/**
 * Create the relay factory. One factory per shell; `attach` is called by the
 * container view for the live iframe and the returned disposer detaches it.
 * @param env - the captured remote namespace and the live session feed.
 * @returns `attach(frame, ref)` → detach disposer.
 */
export function createAppStageBridge(env: {
  readonly remote: BridgeRemote
  readonly session: () => SessionId | undefined
}): (frame: HTMLIFrameElement, ref: string) => () => void {
  return (frame, ref) => {
    let lastRev = 0
    let poller: ReturnType<typeof setInterval> | undefined
    let detached = false

    const post = (reply: BridgeReply): void => {
      if (detached) return
      const target = frame.contentWindow
      if (target === null) return
      target.postMessage(reply, '*')
    }

    const errorReply = (id: string, code: string, message: string): void => {
      post({ __appStage: 1, proto: 1, id, ok: false, error: { code, message } })
    }

    const sessionId = (): SessionId => {
      const current = env.session()
      if (current === undefined) {
        throw new Error('BRIDGE_NO_SESSION: the App Stage shell has no current session.')
      }
      return current
    }

    const pull = (): void => {
      const session = env.session()
      if (session === undefined) return
      void env.remote.dataChanges(session, ref, lastRev).then((wire: RemoteResult<AppStageDataChangesResult>) => {
        if (detached || !wire.ok || !wire.value.ok || wire.value.changes.length === 0) return
        lastRev = wire.value.rev
        post({ __appStage: 1, proto: 1, id: '*', op: 'data.event', ok: true, changes: [...wire.value.changes], rev: wire.value.rev })
      }).catch(() => { /* a failed poll is retried on cadence */ })
    }

    /** Post the journal tail after `since` down as one data.event, advancing
     * the subscription cursor. Used to echo an applied write immediately. */
    const broadcastSince = (since: number): void => {
      const session = env.session()
      if (session === undefined) return
      void env.remote.dataChanges(session, ref, since).then((wire: RemoteResult<AppStageDataChangesResult>) => {
        if (detached || !wire.ok || !wire.value.ok || wire.value.changes.length === 0) return
        lastRev = Math.max(lastRev, wire.value.rev)
        post({ __appStage: 1, proto: 1, id: '*', op: 'data.event', ok: true, changes: [...wire.value.changes], rev: wire.value.rev })
      }).catch(() => { /* the cadence poller will carry the tail instead */ })
    }

    const ensurePoller = (): void => {
      if (poller !== undefined) return
      poller = setInterval(pull, BRIDGE_POLL_MS)
    }

    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return
      const inbound = parseInbound(event.data)
      if (inbound === undefined) return
      if (inbound.__appStage !== 1) {
        errorReply(inbound.id, 'PROTOCOL_UNSUPPORTED', `bridge protocol ${inbound.__appStage} is not supported; this host speaks v1.`)
        return
      }
      switch (inbound.op) {
        case 'data.get': {
          const session = sessionId()
          void env.remote.dataGet(session, ref, inbound.path).then((wire: RemoteResult<AppStageDataGetResult>) => {
            if (detached) return
            if (wire.ok && wire.value.ok) post({ __appStage: 1, proto: 1, id: inbound.id, ok: true, value: wire.value.value, rev: wire.value.rev })
            else if (wire.ok && !wire.value.ok) errorReply(inbound.id, wire.value.code, wire.value.message)
            else if (!wire.ok) errorReply(inbound.id, wire.error.code, wire.error.message)
          }).catch(reason => { errorReply(inbound.id, 'BRIDGE_FAILURE', String(reason)) })
          break
        }
        case 'data.set': {
          if (inbound.path === undefined) {
            errorReply(inbound.id, 'PATH_INVALID', 'data.set requires a key path.')
            break
          }
          const session = sessionId()
          const causeId = `ui-${crypto.randomUUID()}`
          void env.remote.dataSet(session, ref, inbound.path, inbound.value ?? null, causeId).then((wire: RemoteResult<AppStageDataSetResult>) => {
            if (detached) return
            if (wire.ok && wire.value.ok) {
              post({ __appStage: 1, proto: 1, id: inbound.id, ok: true, rev: wire.value.rev })
              // Broadcast the applied write to every listener of the same
              // document (multi-instance): pull exactly this write's journal
              // tail — the writer's own subscribers hear it like any other.
              broadcastSince(wire.value.rev - 1)
            } else if (wire.ok && !wire.value.ok) {
              errorReply(inbound.id, wire.value.code, wire.value.message)
            } else if (!wire.ok) {
              errorReply(inbound.id, wire.error.code, wire.error.message)
            }
          }).catch(reason => { errorReply(inbound.id, 'BRIDGE_FAILURE', String(reason)) })
          break
        }
        case 'data.subscribe': {
          if (typeof inbound.sinceRev === 'number') lastRev = inbound.sinceRev
          // Prime with the current tail, then keep polling on cadence.
          const session = sessionId()
          void env.remote.dataChanges(session, ref, lastRev).then((wire: RemoteResult<AppStageDataChangesResult>) => {
            if (detached || !wire.ok || !wire.value.ok) return
            lastRev = wire.value.rev
            if (wire.value.changes.length > 0) post({ __appStage: 1, proto: 1, id: inbound.id, ok: true, op: 'data.event', changes: [...wire.value.changes], rev: wire.value.rev })
            else post({ __appStage: 1, proto: 1, id: inbound.id, ok: true, rev: wire.value.rev })
          }).catch(() => { errorReply(inbound.id, 'BRIDGE_FAILURE', 'subscription prime failed') })
          ensurePoller()
          break
        }
        case 'data.unsubscribe': {
          if (poller !== undefined) clearInterval(poller)
          poller = undefined
          post({ __appStage: 1, proto: 1, id: inbound.id, ok: true })
          break
        }
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      detached = true
      window.removeEventListener('message', onMessage)
      if (poller !== undefined) clearInterval(poller)
      poller = undefined
    }
  }
}
