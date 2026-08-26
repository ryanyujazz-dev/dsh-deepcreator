/**
 * The Stage router hub — the M4 operation face's routing core.
 *
 * `app_invoke` and `app_open` must execute inside the GUI's Stage container
 * ("only the Stage container, never a hidden runner"), but the executor lives
 * in the browser while the calling agent tool lives in the host process. The
 * official host→client push allowlist (`API_REMOTE_FORWARDED_EVENTS`) is a
 * frozen const, so this hub rides the official long-poll idiom instead — the
 * same transport `browser-runtime.waitStateRevision` established: the client
 * parks in `waitRouterRequests` until a request lands (or a 25 s cadence
 * tick), executes it against the live iframe, and reports back through
 * `routerResult`. One queue, one monotonic cursor, zero official-package
 * surface.
 *
 * Router presence is observable from poll arrivals, which turns "no GUI is
 * connected" into the actionable CONTAINER_UNAVAILABLE instead of a silent
 * 30 s timeout (the headless-session contract).
 * @module @ryanyujazz/dsh-app-stage/control
 */
import type { AppRouterOutcome, AppRouterRequest } from './types.ts'

/** How long a parked router poll waits before returning empty (the cadence). */
export const ROUTER_POLL_MS = 25_000

/** `app_invoke` single-call ceiling (E1): the command may already have run. */
export const INVOKE_TIMEOUT_MS = 30_000

/** `app_open` single-call ceiling (E1): container cold start budget. */
export const OPEN_TIMEOUT_MS = 15_000

/** Grace before a request with no connected router fails as unavailable. */
export const ROUTER_PRESENCE_GRACE_MS = 3_000

/** A poll arrival within this window counts as "a router is connected". */
export const ROUTER_SEEN_WINDOW_MS = 40_000

/** How a pushed request came home. */
export type RoutedSettlement =
  | { readonly kind: 'reported'; readonly outcome: AppRouterOutcome }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'unavailable' }

/** One queued request plus its completion machinery. */
interface QueueEntry {
  readonly request: AppRouterRequest
  readonly resolve: (settlement: RoutedSettlement) => void
  readonly timers: Array<ReturnType<typeof setTimeout>>
}

/** One parked router long-poll. */
interface ParkedPoll {
  readonly resolve: (reply: { requests: AppRouterRequest[]; cursor: number }) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/**
 * The hub: a monotonic queue of router requests. Owned by the resident
 * service; the @Remote methods delegate here. Request ids encode the cursor
 * (`r<seq>`), so numeric resume and id uniqueness are the same fact.
 */
export class AppRouterHub {
  private seq = 0
  private readonly queue: QueueEntry[] = []
  private readonly parked: ParkedPoll[] = []
  private routerLastSeen = 0

  /** A router is connected when a poll arrived inside the seen-window. */
  get routerConnected(): boolean {
    return Date.now() - this.routerLastSeen < ROUTER_SEEN_WINDOW_MS
  }

  /** The cursor a fresh router poll should resume after. */
  get cursor(): number {
    return this.seq
  }

  /** `waitRouterRequests` body: deliver what is queued after `after`, or park. */
  waitRequests(after: number): Promise<{ requests: AppRouterRequest[]; cursor: number }> {
    this.routerLastSeen = Date.now()
    const queued = this.queue.filter(entry => this.seqOf(entry) > after).map(entry => entry.request)
    if (queued.length > 0) return Promise.resolve({ requests: queued, cursor: this.seq })
    return new Promise(resolve => {
      const poll: ParkedPoll = {
        resolve,
        timer: setTimeout(() => {
          this.unpark(poll)
          this.routerLastSeen = Date.now()
          resolve({ requests: [], cursor: this.seq })
        }, ROUTER_POLL_MS),
      }
      this.parked.push(poll)
    })
  }

  /**
   * `routerResult` body: resolve the matching pending request. Unknown or
   * already-settled ids return false (the wire ack turns that into
   * UNKNOWN_REQUEST); the entry is gone either way, so double reports are
   * idempotent.
   */
  reportResult(requestId: string, outcome: AppRouterOutcome): boolean {
    const index = this.queue.findIndex(entry => entry.request.requestId === requestId)
    if (index < 0) return false
    const [entry] = this.queue.splice(index, 1)
    if (entry === undefined) return false
    for (const timer of entry.timers) clearTimeout(timer)
    entry.resolve({ kind: 'reported', outcome })
    return true
  }

  /**
   * Push one request and await its settlement. `timeoutMs` is the single-call
   * ceiling (E1); when no router is connected a shorter presence grace races
   * it so a headless session fails fast with `unavailable` instead of burning
   * the whole window.
   */
  push(request: Omit<AppRouterRequest, 'requestId'>, timeoutMs: number): Promise<RoutedSettlement> {
    const requestId = `r${++this.seq}`
    const full: AppRouterRequest = { ...request, requestId }
    return new Promise<RoutedSettlement>(resolve => {
      const entry: QueueEntry = { request: full, resolve, timers: [] }
      entry.timers.push(setTimeout(() => {
        this.drop(requestId)
        resolve({ kind: 'timeout' })
      }, timeoutMs))
      if (!this.routerConnected) {
        entry.timers.push(setTimeout(() => {
          if (!this.routerConnected) {
            this.drop(requestId)
            resolve({ kind: 'unavailable' })
          }
        }, ROUTER_PRESENCE_GRACE_MS))
      }
      this.queue.push(entry)
      for (const poll of [...this.parked]) {
        clearTimeout(poll.timer)
        this.unpark(poll)
        poll.resolve({ requests: [full], cursor: this.seq })
      }
    })
  }

  /** Settle-and-forget helper for tests and disposal paths. */
  private drop(requestId: string): void {
    const index = this.queue.findIndex(entry => entry.request.requestId === requestId)
    if (index < 0) return
    const [entry] = this.queue.splice(index, 1)
    if (entry === undefined) return
    for (const timer of entry.timers) clearTimeout(timer)
  }

  private unpark(poll: ParkedPoll): void {
    const index = this.parked.indexOf(poll)
    if (index >= 0) this.parked.splice(index, 1)
  }

  private seqOf(entry: QueueEntry): number {
    return Number(entry.request.requestId.slice(1))
  }
}
