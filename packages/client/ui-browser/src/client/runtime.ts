import type { BrowserRemoteResult, BrowserStateSnapshot } from '@ryanyujazz/dsh-browser/types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export interface BrowserSurfaceBridge {
  mount(surfaceId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
  setBounds(surfaceId: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
  setVisible(surfaceId: string, visible: boolean): Promise<void>
  unmount(surfaceId: string): Promise<void>
}
export interface BrowserRemoteClient {
  state(sessionId: SessionId): Promise<RemoteResult<BrowserRemoteResult<BrowserStateSnapshot>>>
  waitStateRevision?(sessionId: SessionId, afterRevision: number): Promise<RemoteResult<BrowserRemoteResult<{ revision: number }>>>
  clearBrowserData?(browserId: string): Promise<RemoteResult<BrowserRemoteResult<{ cleared: string[]; unavailable: string[] }>>>
  manageProvider?(browserId: string, action: 'install' | 'repair' | 'uninstall'): Promise<RemoteResult<BrowserRemoteResult<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }>>>
  snapshotImage?(tabId: string): Promise<RemoteResult<BrowserRemoteResult<{ artifactId: string; dataUrl: string }>>>
}

const EMPTY_STATE: BrowserStateSnapshot = { sessionId: '', revision: 0, browsers: [], tabs: [] }
export interface BrowserClientSnapshot { state: BrowserStateSnapshot; error?: string }
export type BrowserSurfaceMountFailure = {
  code: 'PANEL_RENDER_TIMEOUT' | 'SURFACE_MOUNT_REJECTED' | 'SURFACE_MOUNT_TIMEOUT' | 'SURFACE_DESTROYED'
  message: string
}
export type BrowserSurfaceMountOutcome = { ok: true } | { ok: false; failure: BrowserSurfaceMountFailure }
type BrowserSurfaceMountState = { phase: 'started' } | { phase: 'mounted' } | { phase: 'failed'; failure: BrowserSurfaceMountFailure }

/** React-free Browser state store. Presentation claiming lives in @ryanyujazz/dsh-client-presentation. */
export class BrowserClientRuntime {
  readonly #listeners = new Set<() => void>()
  readonly #surfaceWaiters = new Map<string, Set<(outcome: BrowserSurfaceMountOutcome) => void>>()
  readonly #surfaces = new Map<string, BrowserSurfaceMountState>()
  readonly #snapshotImages = new Map<string, string>()
  #state = EMPTY_STATE
  #snapshot: BrowserClientSnapshot = { state: EMPTY_STATE }
  #error: string | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  #watching = false
  #busy = false
  constructor(readonly remote: BrowserRemoteClient, private readonly currentSessionId: () => SessionId | undefined) {}

  /** useSyncExternalStore requires referential stability until a real publish. */
  getSnapshot = (): BrowserClientSnapshot => this.#snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    if (!this.#watching && this.#timer === undefined) {
      if (this.remote.waitStateRevision === undefined) { this.#timer = setInterval(() => { void this.refresh() }, 500); void this.refresh() }
      else { this.#watching = true; void this.refresh().then(() => this.#watch()) }
    }
    return () => { this.#listeners.delete(listener); if (this.#listeners.size === 0) { this.#watching = false; if (this.#timer !== undefined) clearInterval(this.#timer); this.#timer = undefined } }
  }
  async refresh(): Promise<void> {
    if (this.#busy) return
    this.#busy = true
    try {
      const sessionId = this.currentSessionId()
      if (sessionId === undefined) return
      const wire = await this.remote.state(sessionId)
      if (!wire.ok) { this.#setError(`${wire.error.code}: ${wire.error.message}`); return }
      if (!wire.value.ok) { this.#setError(`${wire.value.code}: ${wire.value.message}`); return }
      let next = wire.value.value
      if (this.remote.snapshotImage !== undefined) {
        await Promise.all(next.tabs.map(async tab => {
          if (tab.snapshotArtifactId === undefined || this.#snapshotImages.has(tab.snapshotArtifactId)) return
          const image = await this.remote.snapshotImage!(tab.tabId).catch(() => undefined)
          if (image?.ok === true && image.value.ok && image.value.value.artifactId === tab.snapshotArtifactId) this.#snapshotImages.set(tab.snapshotArtifactId, image.value.value.dataUrl)
        }))
        next = { ...next, tabs: next.tabs.map(tab => tab.snapshotArtifactId === undefined ? tab : { ...tab, ...(this.#snapshotImages.get(tab.snapshotArtifactId) === undefined ? {} : { snapshotImageDataUrl: this.#snapshotImages.get(tab.snapshotArtifactId)! }) }) }
      }
      if (next.revision !== this.#state.revision || next.sessionId !== this.#state.sessionId || this.#error !== undefined) {
        this.#state = next; this.#error = undefined; this.#publish()
      }
    } catch (error) { this.#setError(error instanceof Error ? error.message : String(error)) }
    finally { this.#busy = false }
  }
  surfaceMountStarted(tabId: string): void { this.#surfaces.set(tabId, { phase: 'started' }) }
  surfaceMounted(tabId: string): void { this.#surfaces.set(tabId, { phase: 'mounted' }); this.#settleSurface(tabId, { ok: true }) }
  surfaceMountFailed(tabId: string, message: string): void {
    const failure: BrowserSurfaceMountFailure = { code: 'SURFACE_MOUNT_REJECTED', message }
    this.#surfaces.set(tabId, { phase: 'failed', failure }); this.#settleSurface(tabId, { ok: false, failure })
  }
  surfaceUnmounted(tabId: string): void {
    const state = this.#surfaces.get(tabId)
    this.#surfaces.delete(tabId)
    if (state?.phase === 'started') this.#settleSurface(tabId, { ok: false, failure: { code: 'SURFACE_DESTROYED', message: 'The Browser panel unmounted before its native surface became ready.' } })
  }
  waitForSurface(tabId: string, timeoutMs: number): Promise<BrowserSurfaceMountOutcome> {
    const current = this.#surfaces.get(tabId)
    if (current?.phase === 'mounted') return Promise.resolve({ ok: true })
    if (current?.phase === 'failed') return Promise.resolve({ ok: false, failure: current.failure })
    return new Promise(resolve => {
      let waiters = this.#surfaceWaiters.get(tabId)
      if (waiters === undefined) { waiters = new Set(); this.#surfaceWaiters.set(tabId, waiters) }
      const finish = (outcome: BrowserSurfaceMountOutcome) => { clearTimeout(timer); waiters?.delete(finish); if (waiters?.size === 0) this.#surfaceWaiters.delete(tabId); resolve(outcome) }
      const timer = setTimeout(() => {
        const state = this.#surfaces.get(tabId)
        finish({ ok: false, failure: state?.phase === 'started'
          ? { code: 'SURFACE_MOUNT_TIMEOUT', message: 'The native Browser surface mount did not settle before the presentation deadline.' }
          : { code: 'PANEL_RENDER_TIMEOUT', message: 'The Browser panel did not render its live surface anchor before the presentation deadline.' } })
      }, Math.max(1, timeoutMs))
      waiters.add(finish)
    })
  }
  dispose(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer); this.#watching = false; this.#timer = undefined; this.#listeners.clear(); this.#surfaces.clear(); this.#snapshotImages.clear()
    for (const waiters of this.#surfaceWaiters.values()) for (const resolve of waiters) resolve({ ok: false, failure: { code: 'SURFACE_DESTROYED', message: 'The Browser client stopped before its native surface became ready.' } })
    this.#surfaceWaiters.clear()
  }
  async #watch(): Promise<void> {
    while (this.#watching && this.#listeners.size > 0 && this.remote.waitStateRevision !== undefined) {
      const sessionId = this.currentSessionId()
      if (sessionId === undefined) { await this.#delay(250); continue }
      try {
        const wire = await this.remote.waitStateRevision(sessionId, this.#state.sessionId === String(sessionId) ? this.#state.revision : -1)
        if (wire.ok && wire.value.ok && (wire.value.value.revision !== this.#state.revision || this.#state.sessionId !== String(sessionId))) await this.refresh()
        else if (!wire.ok || !wire.value.ok) await this.#delay(500)
      } catch { await this.#delay(500) }
    }
  }
  #delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)) }
  #settleSurface(tabId: string, outcome: BrowserSurfaceMountOutcome): void { for (const resolve of this.#surfaceWaiters.get(tabId) ?? []) resolve(outcome); this.#surfaceWaiters.delete(tabId) }
  #setError(error: string): void { if (this.#error === error) return; this.#error = error; this.#publish() }
  #publish(): void { this.#snapshot = { state: this.#state, ...(this.#error === undefined ? {} : { error: this.#error }) }; this.#emit() }
  #emit(): void { for (const listener of this.#listeners) listener() }
}
