import type { BrowserNextAction, BrowserRemoteResult, BrowserStateSnapshot, BrowserTabState } from '@ryanyujazz/dsh-browser/types'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
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
  newTab?(sessionId: SessionId): Promise<RemoteResult<BrowserRemoteResult<{ tab: BrowserTabState; nextAction: BrowserNextAction }>>>
  navigateTab?(sessionId: SessionId, tabId: string, url: string): Promise<RemoteResult<BrowserRemoteResult<{ tab: BrowserTabState }>>>
  closeTab?(sessionId: SessionId, tabId: string): Promise<RemoteResult<BrowserRemoteResult<{ closed: true; tabId: string }>>>
  clearBrowserData?(browserId: string): Promise<RemoteResult<BrowserRemoteResult<{ cleared: string[]; unavailable: string[] }>>>
  manageProvider?(browserId: string, action: 'install' | 'repair' | 'uninstall'): Promise<RemoteResult<BrowserRemoteResult<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }>>>
  snapshotImage?(sessionId: SessionId, tabId: string): Promise<RemoteResult<BrowserRemoteResult<{ attachment: ImageAttachmentRef; dataUrl: string }>>>
}

function snapshotKey(tab: BrowserTabState): string | undefined {
  return tab.snapshotAttachment === undefined ? undefined : String(tab.snapshotAttachment.attachmentId)
}

const EMPTY_STATE: BrowserStateSnapshot = { sessionId: '', revision: 0, browsers: [], tabs: [] }
export interface BrowserClientSnapshot { state: BrowserStateSnapshot; snapshotErrors: Readonly<Record<string, string>>; error?: string }
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
  readonly #snapshotErrors = new Map<string, { attachmentId: string; message: string }>()
  readonly #snapshotAttempts = new Map<string, number>()
  readonly #snapshotRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #closingTabs = new Set<string>()
  #state = EMPTY_STATE
  #snapshot: BrowserClientSnapshot = { state: EMPTY_STATE, snapshotErrors: {} }
  #error: string | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  #watching = false
  #busy = false
  constructor(readonly remote: BrowserRemoteClient, private readonly currentSessionId: () => SessionId | undefined) {}

  /** useSyncExternalStore requires referential stability until a real publish. */
  getSnapshot = (): BrowserClientSnapshot => this.#snapshot
  hasCurrentSessionSnapshot(): boolean {
    const sessionId = this.currentSessionId()
    return sessionId !== undefined && this.#state.sessionId === String(sessionId)
  }
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    if (!this.#watching && this.#timer === undefined) {
      if (this.remote.waitStateRevision === undefined) { this.#timer = setInterval(() => { void this.refresh() }, 500); void this.refresh() }
      else { this.#watching = true; void this.refresh().then(() => this.#watch()) }
    }
    return () => { this.#listeners.delete(listener); if (this.#listeners.size === 0) { this.#watching = false; if (this.#timer !== undefined) clearInterval(this.#timer); this.#timer = undefined } }
  }
  async refresh(): Promise<void> {
    // A caller that awaits refresh is asking for a snapshot fetched no earlier
    // than this call. Do not silently succeed against an older in-flight read:
    // presentation may otherwise route to a tab that the client has not seen.
    if (this.#busy) {
      while (this.#busy) await this.#delay(10)
      return this.refresh()
    }
    this.#busy = true
    try {
      const sessionId = this.currentSessionId()
      if (sessionId === undefined) return
      const wire = await this.remote.state(sessionId)
      // Session-scoped Browser state cannot cross an address change. A late
      // response is discarded; a refresh queued behind this one will fetch the
      // newly-current session.
      if (this.currentSessionId() !== sessionId) return
      if (!wire.ok) { this.#setError(`${wire.error.code}: ${wire.error.message}`); return }
      if (!wire.value.ok) { this.#setError(`${wire.value.code}: ${wire.value.message}`); return }
      let next = wire.value.value
      this.#pruneSnapshots(next)
      next = this.#withSnapshotImages(next)
      if (next.revision !== this.#state.revision || next.sessionId !== this.#state.sessionId || this.#error !== undefined) {
        this.#state = next; this.#error = undefined; this.#publish()
      }
      await this.#hydrateSnapshots(wire.value.value)
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
  async newTab(): Promise<BrowserTabState> {
    if (this.remote.newTab === undefined) throw new Error('PRESENTATION_UNAVAILABLE: Browser tab creation is unavailable in this deployment.')
    const sessionId = this.#requireSession()
    const wire = await this.remote.newTab(sessionId)
    if (!wire.ok) throw new Error(`${wire.error.code}: ${wire.error.message}`)
    if (!wire.value.ok) throw new Error(`${wire.value.code}: ${wire.value.message}`)
    await this.#refreshAfterMutation()
    return wire.value.value.tab
  }
  async navigateTab(tabId: string, url: string): Promise<void> {
    if (this.remote.navigateTab === undefined) throw new Error('PRESENTATION_UNAVAILABLE: Browser navigation is unavailable in this deployment.')
    const sessionId = this.#requireSession()
    const wire = await this.remote.navigateTab(sessionId, tabId, url)
    if (!wire.ok) throw new Error(`${wire.error.code}: ${wire.error.message}`)
    if (!wire.value.ok) throw new Error(`${wire.value.code}: ${wire.value.message}`)
    await this.#refreshAfterMutation()
  }
  async closeTab(tabId: string): Promise<void> {
    if (this.#closingTabs.has(tabId)) return
    if (this.remote.closeTab === undefined) { this.#setError('PRESENTATION_UNAVAILABLE: Browser tab closing is unavailable in this deployment.'); return }
    this.#closingTabs.add(tabId)
    try {
      const sessionId = this.#requireSession()
      const wire = await this.remote.closeTab(sessionId, tabId)
      if (!wire.ok) { this.#setError(`${wire.error.code}: ${wire.error.message}`); return }
      if (!wire.value.ok) {
        // Older Hosts may still report a duplicate destruction as missing.
        // It is already the desired end state, not a Runtime outage.
        if (wire.value.code === 'TAB_NOT_FOUND') { this.#dropTabPreview(tabId); await this.#refreshAfterMutation(); return }
        this.#setError(`${wire.value.code}: ${wire.value.message}`); return
      }
      this.#dropTabPreview(tabId)
      await this.#refreshAfterMutation()
    } catch (error) { this.#setError(error instanceof Error ? error.message : String(error)) }
    finally { this.#closingTabs.delete(tabId) }
  }
  async retrySnapshot(tabId: string): Promise<void> {
    const tab = this.#state.tabs.find(candidate => candidate.tabId === tabId)
    const key = tab === undefined ? undefined : snapshotKey(tab)
    if (key === undefined) return
    this.#snapshotImages.delete(key)
    this.#snapshotErrors.delete(tabId)
    this.#snapshotAttempts.delete(key)
    const timer = this.#snapshotRetryTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.#snapshotRetryTimers.delete(key)
    this.#publish()
    await this.refresh()
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
    if (this.#timer !== undefined) clearInterval(this.#timer); this.#watching = false; this.#timer = undefined; this.#listeners.clear(); this.#surfaces.clear(); this.#snapshotImages.clear(); this.#snapshotErrors.clear(); this.#snapshotAttempts.clear(); this.#closingTabs.clear()
    for (const timer of this.#snapshotRetryTimers.values()) clearTimeout(timer)
    this.#snapshotRetryTimers.clear()
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
  async #refreshAfterMutation(): Promise<void> {
    await this.refresh()
  }
  async #hydrateSnapshots(state: BrowserStateSnapshot): Promise<void> {
    let changed = false
    await Promise.all(state.tabs.map(async tab => {
      const attachmentId = snapshotKey(tab)
      if (attachmentId === undefined || this.#snapshotImages.has(attachmentId)) return
      const failure = this.#snapshotErrors.get(tab.tabId)
      if ((this.#snapshotAttempts.get(attachmentId) ?? 0) >= 3 && failure?.attachmentId === attachmentId) return
      if (this.remote.snapshotImage === undefined) {
        changed = this.#setSnapshotError(tab.tabId, attachmentId, 'PRESENTATION_UNAVAILABLE: Screenshot preview Remote is unavailable.') || changed
        return
      }
      try {
        const sessionId = this.#requireSession()
        const image = await this.remote.snapshotImage(sessionId, tab.tabId)
        if (!image.ok) throw new Error(`${image.error.code}: ${image.error.message}`)
        if (!image.value.ok) throw new Error(`${image.value.code}: ${image.value.message}`)
        const receivedId = String(image.value.value.attachment.attachmentId)
        if (receivedId !== attachmentId) throw new Error(`STALE_SNAPSHOT: Expected ${attachmentId}, received ${receivedId}.`)
        this.#snapshotImages.set(attachmentId, image.value.value.dataUrl)
        this.#snapshotAttempts.delete(attachmentId)
        const timer = this.#snapshotRetryTimers.get(attachmentId)
        if (timer !== undefined) clearTimeout(timer)
        this.#snapshotRetryTimers.delete(attachmentId)
        changed = this.#snapshotErrors.delete(tab.tabId) || changed
        changed = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        changed = this.#setSnapshotError(tab.tabId, attachmentId, message) || changed
        this.#scheduleSnapshotRetry(attachmentId)
      }
    }))
    if (!changed) return
    this.#state = this.#withSnapshotImages(this.#state)
    this.#publish()
  }
  #withSnapshotImages(state: BrowserStateSnapshot): BrowserStateSnapshot {
    return { ...state, tabs: state.tabs.map(tab => {
      const key = snapshotKey(tab)
      return key === undefined ? tab : { ...tab, ...(this.#snapshotImages.get(key) === undefined ? {} : { snapshotImageDataUrl: this.#snapshotImages.get(key)! }) }
    }) }
  }
  #setSnapshotError(tabId: string, attachmentId: string, message: string): boolean {
    const current = this.#snapshotErrors.get(tabId)
    if (current?.attachmentId === attachmentId && current.message === message) return false
    this.#snapshotErrors.set(tabId, { attachmentId, message })
    return true
  }
  #scheduleSnapshotRetry(attachmentId: string): void {
    const attempts = (this.#snapshotAttempts.get(attachmentId) ?? 0) + 1
    this.#snapshotAttempts.set(attachmentId, attempts)
    if (attempts >= 3 || this.#snapshotRetryTimers.has(attachmentId)) return
    const timer = setTimeout(() => { this.#snapshotRetryTimers.delete(attachmentId); void this.refresh() }, 250 * (2 ** (attempts - 1)))
    this.#snapshotRetryTimers.set(attachmentId, timer)
  }
  #pruneSnapshots(state: BrowserStateSnapshot): void {
    const current = new Map(state.tabs.flatMap(tab => { const key = snapshotKey(tab); return key === undefined ? [] : [[tab.tabId, key] as const] }))
    for (const [tabId, error] of this.#snapshotErrors) if (current.get(tabId) !== error.attachmentId) this.#snapshotErrors.delete(tabId)
    const attachments = new Set(current.values())
    for (const attachmentId of this.#snapshotImages.keys()) if (!attachments.has(attachmentId)) this.#snapshotImages.delete(attachmentId)
    for (const attachmentId of this.#snapshotAttempts.keys()) if (!attachments.has(attachmentId)) this.#snapshotAttempts.delete(attachmentId)
    for (const [attachmentId, timer] of this.#snapshotRetryTimers) if (!attachments.has(attachmentId)) { clearTimeout(timer); this.#snapshotRetryTimers.delete(attachmentId) }
  }
  #dropTabPreview(tabId: string): void {
    const tab = this.#state.tabs.find(candidate => candidate.tabId === tabId)
    const key = tab === undefined ? undefined : snapshotKey(tab)
    if (key !== undefined) {
      this.#snapshotImages.delete(key)
      this.#snapshotAttempts.delete(key)
      const timer = this.#snapshotRetryTimers.get(key)
      if (timer !== undefined) clearTimeout(timer)
      this.#snapshotRetryTimers.delete(key)
    }
    this.#snapshotErrors.delete(tabId)
  }
  #settleSurface(tabId: string, outcome: BrowserSurfaceMountOutcome): void { for (const resolve of this.#surfaceWaiters.get(tabId) ?? []) resolve(outcome); this.#surfaceWaiters.delete(tabId) }
  #setError(error: string): void { if (this.#error === error) return; this.#error = error; this.#publish() }
  #requireSession(): SessionId {
    const sessionId = this.currentSessionId()
    if (sessionId === undefined) throw new Error('TAB_NOT_OWNED: No active session owns this Browser operation.')
    return sessionId
  }
  #publish(): void {
    const snapshotErrors = Object.fromEntries([...this.#snapshotErrors].flatMap(([tabId, failure]) => this.#state.tabs.some(tab => tab.tabId === tabId && snapshotKey(tab) === failure.attachmentId) ? [[tabId, failure.message]] : []))
    this.#snapshot = { state: this.#state, snapshotErrors, ...(this.#error === undefined ? {} : { error: this.#error }) }; this.#emit()
  }
  #emit(): void { for (const listener of this.#listeners) listener() }
}
