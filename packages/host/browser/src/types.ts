import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'

export type BrowserProviderKind = 'managed' | 'in-app' | 'extension'
export type BrowserFamily = 'chrome' | 'chromium' | 'firefox' | 'webkit'
export type BrowserProfileKind = 'isolated' | 'managed-persistent' | 'user'
export type BrowserPresentationMode = 'live' | 'snapshot' | 'none'
export type BrowserPresentationOwner = 'deepcreator' | 'provider' | 'none'

/** Namespaced strings keep Browser Core independent from concrete Provider implementations. */
/** Capabilities shipped by Browser Core. Providers may contribute additional namespaced strings. */
export type KnownBrowserCapability =
  | 'core.tabs' | 'core.navigation' | 'core.snapshot' | 'core.screenshot' | 'core.semantic-actions' | 'core.wait'
  | 'io.upload' | 'io.download'
  | 'profile.user-tabs' | 'profile.user'
  | 'interaction.manual-handoff' | 'interaction.interruptible' | 'interaction.secret-input-shielded'
  | 'presentation.live' | 'presentation.snapshot' | 'presentation.deepcreator-surface'
  | 'automation.playwright'

/**
 * Wire-level capability names are intentionally plain strings. The former
 * `KnownBrowserCapability | (string & {})` autocomplete trick was emitted by
 * Typert as `z.intersection(z.string(), z.object({}))`, making every provider
 * extension such as `management.install` fail Remote result validation.
 */
export type BrowserCapability = string

export type BrowserErrorCode =
  | 'BROWSER_UNAVAILABLE' | 'PROVIDER_UNAVAILABLE' | 'CAPABILITY_UNSUPPORTED'
  | 'TAB_NOT_FOUND' | 'TAB_NOT_OWNED' | 'STALE_SNAPSHOT' | 'AMBIGUOUS_LOCATOR' | 'INVALID_ACTION' | 'CONTROL_INTERRUPTED'
  | 'NAVIGATION_BLOCKED' | 'APPROVAL_DENIED' | 'AUTH_REQUIRED' | 'ACCESS_DENIED' | 'HEADLESS_BLOCKED' | 'TIMEOUT'
  | 'POSTCONDITION_TIMEOUT' | 'POPUP_BLOCKED'
  | 'PAGE_CRASHED' | 'PRESENTATION_UNAVAILABLE' | 'PROFILE_LOCKED'
  | 'PLAYWRIGHT_COMPILE_ERROR' | 'PLAYWRIGHT_RUNTIME_ERROR' | 'PLAYWRIGHT_POLICY_BLOCKED'
  | 'STALE_DOCUMENT' | 'PLAYWRIGHT_ISOLATE_CRASHED'

export type BrowserTabRemovalReason = 'provider-close' | 'turn-cleanup' | 'client-close' | 'presentation-rollback' | 'owner-restarted' | 'runtime-dispose'
export interface BrowserErrorDetails {
  httpStatus?: number
  finalUrl?: string
  lifecycleReason?: BrowserTabRemovalReason
  suggestedNextStep?: string
  receivedBytes?: number
  timeoutPhase?: 'connect' | 'first-byte' | 'download' | 'decompress' | 'total'
  documentId?: string
  tabId?: string
  providerTabId?: string
  failedStep?: number
  actionApplied?: boolean
  completedSteps?: number
  failedPhase?: 'action' | 'postcondition'
  postcondition?: 'navigation' | 'url' | 'download'
  popupUrl?: string
  durationMs?: number
  recentEvents?: BrowserTabEvent[]
}
export type BrowserRemoteResult<T> = { ok: true; value: T } | { ok: false; code: BrowserErrorCode; message: string; details?: BrowserErrorDetails }

/** Runtime-neutral cancellation face; Provider contracts do not depend on DOM AbortSignal declarations. */
export interface BrowserSignalInput { readonly aborted: boolean }
export interface BrowserSignal extends BrowserSignalInput { subscribe(listener: () => void): () => void }
export function browserSignal(input: BrowserSignalInput): BrowserSignal {
  const candidate = input as BrowserSignalInput & { subscribe?: (listener: () => void) => () => void; addEventListener?: (type: string, listener: () => void, options?: { once?: boolean }) => void; removeEventListener?: (type: string, listener: () => void) => void }
  return {
    get aborted() { return input.aborted },
    subscribe(listener) {
      if (input.aborted) { listener(); return () => undefined }
      if (candidate.subscribe !== undefined) return candidate.subscribe(listener)
      if (candidate.addEventListener === undefined) return () => undefined
      candidate.addEventListener('abort', listener, { once: true })
      return () => candidate.removeEventListener?.('abort', listener)
    },
  }
}

export interface BrowserDescriptor {
  browserId: string
  name: string
  providerKind: BrowserProviderKind
  family: BrowserFamily
  profile: BrowserProfileKind
  capabilities: BrowserCapability[]
  presentation: PresentationBinding
  availability: 'available' | 'unavailable'
  diagnostic?: string
}

export interface PresentationBinding {
  owner: BrowserPresentationOwner
  mode: BrowserPresentationMode
  requiredBeforeControl: boolean
}

export interface BrowserRequirements {
  automation?: 'semantic' | 'playwright'
  visibility?: 'background' | 'snapshot' | 'live'
  interaction?: 'agent-only' | 'manual-handoff' | 'interruptible'
  profile?: BrowserProfileKind
  capabilities?: BrowserCapability[]
}

export interface BrowserPreference {
  browserId?: string
  family?: BrowserFamily
  providerKind?: BrowserProviderKind
}

export interface BrowserRequirementAssessment {
  browserId: string
  satisfied: boolean
  missing: string[]
}

export interface BrowserResolution {
  browser: BrowserDescriptor
  reasons: string[]
  assessments: BrowserRequirementAssessment[]
}

export interface BrowserProviderContext {
  automationSessionId: string
  workspaceRoot: string
  signal: BrowserSignal
}

export interface BrowserTabRequest { url?: string; lifecycle?: BrowserTabLifecycle; requirements?: BrowserRequirements }
export interface ProviderTab {
  providerTabId: string
  surfaceId?: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** A Provider may choose a per-tab presentation shape (for example headed Playwright). */
  presentation?: PresentationBinding
}
export interface UserTabCandidate extends ProviderTab { revision: number }
export type BrowserTabLifecycle = 'temporary' | 'deliverable' | 'handoff' | 'claimed'

export interface BrowserTabState {
  tabId: string
  browserId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  lifecycle: BrowserTabLifecycle
  presentation: BrowserPresentationMode
  presentationBinding: PresentationBinding
  controlState: 'ready' | 'presentation-required' | 'interrupted' | 'user-control'
  presentationState: 'not-requested' | 'pending' | 'presented' | 'suppressed' | 'dismissed' | 'unavailable'
  surfaceId?: string
  snapshotId?: string
  /** Authoritative, durable screenshot reference shared by tools, replay, and Browser Panel. */
  snapshotAttachment?: ImageAttachmentRef
  /** Client-only hydrated preview. Host state snapshots carry snapshotAttachment instead. */
  snapshotImageDataUrl?: string
  lastAction?: { action: string; at: number; result: 'ok' | BrowserErrorCode }
}

export type BrowserTabEventKind =
  | 'command-start' | 'command-complete' | 'command-failed'
  | 'preflight-start' | 'preflight-complete'
  | 'approval-requested' | 'approval-approved' | 'approval-denied'
  | 'postcondition-complete' | 'postcondition-failed'
  | 'popup-blocked'
  | 'url-changed' | 'snapshot-created' | 'snapshot-invalidated'
  | 'control-handoff' | 'control-resumed'
export interface BrowserTabEvent {
  sequence: number
  at: number
  kind: BrowserTabEventKind
  command?: string
  url?: string
  detail?: string
  durationMs?: number
}

export interface BrowserNodeRef {
  nodeRef: string
  role?: string
  name?: string
  value?: string
  inputType?: string
  autocomplete?: string
  href?: string
  target?: string
  opensNewTab?: boolean
  formAction?: string
  formMethod?: string
  /** Provider-neutral locators that can be resolved again after a new snapshot. */
  stableLocators?: BrowserStableLocator[]
}
export interface BrowserSnapshot { snapshotId: string; url: string; title: string; text: string; nodes: BrowserNodeRef[] }
export interface BrowserDocumentPage {
  documentId: string
  text: string
  offset: number
  nextOffset?: number
  truncated: boolean
  contentType: string
  sourceTruncated?: boolean
}
export type BrowserLocator =
  | { kind: 'node'; snapshotId: string; nodeRef: string }
  | { kind: 'role'; role: string; name?: string; exact?: boolean }
  | { kind: 'text'; text: string; exact?: boolean }
  | { kind: 'label'; label: string }

export type BrowserStableLocator = Exclude<BrowserLocator, { kind: 'node' }>
export type BrowserAction = 'click' | 'fill' | 'type' | 'press' | 'select' | 'check' | 'scroll' | 'drag' | 'upload'
export type BrowserUrlMatch = 'exact' | 'contains' | 'glob'
export type BrowserPopupPolicy = 'same-tab' | 'deny'
export interface BrowserActionOutcome {
  actionApplied: true
  completedSteps: number
  durationMs: number
  postcondition?: { kind: 'navigation' | 'url' | 'download'; status: 'satisfied' }
}
export interface BrowserActionStep {
  action: BrowserAction
  locator?: BrowserLocator
  destination?: BrowserLocator
  value?: string
  files?: string[]
}
export interface BrowserActCommand {
  kind: 'act'
  /** Backward-compatible single-action surface. New callers may use steps instead. */
  action?: BrowserAction
  locator?: BrowserLocator
  destination?: BrowserLocator
  value?: string
  files?: string[]
  steps?: BrowserActionStep[]
  expected?: 'none' | 'navigation' | 'download'
  expectedUrl?: string
  urlMatch?: BrowserUrlMatch
  /** Agent semantic actions adopt popups into the current logical tab by default when navigation is expected. */
  popupPolicy?: BrowserPopupPolicy
  /** Runtime-owned atomic observation; Providers execute only the action and postcondition. */
  observe?: 'state' | 'snapshot'
}

export type BrowserCommand =
  | { kind: 'navigate'; action: 'goto' | 'back' | 'forward' | 'reload'; url?: string }
  | { kind: 'inspect'; action: 'snapshot' | 'screenshot' | 'url' | 'title' | 'elementInfo' | 'document' | 'events'; locator?: BrowserLocator; documentId?: string; offset?: number; maxChars?: number }
  | BrowserActCommand
  | { kind: 'wait'; condition: 'url' | 'load' | 'visible' | 'hidden' | 'dialog'; value?: string; urlMatch?: BrowserUrlMatch; locator?: BrowserLocator; timeoutMs?: number }

export type BrowserCommandResult =
  | { kind: 'state'; tab: ProviderTab }
  | { kind: 'action'; outcome: BrowserActionOutcome; observation?: BrowserSnapshot; tab: ProviderTab }
  | { kind: 'snapshot'; snapshot: BrowserSnapshot; tab: ProviderTab }
  | { kind: 'screenshot'; dataUrl: string; tab: ProviderTab }
  | { kind: 'document'; document: BrowserDocumentPage; tab: ProviderTab }
  | { kind: 'elementInfo'; element: BrowserNodeRef; tab: ProviderTab }
  | { kind: 'events'; events: BrowserTabEvent[]; tab: ProviderTab }
  | { kind: 'download'; artifactId: string; fileName: string; outcome?: BrowserActionOutcome; tab: ProviderTab }

export interface BrowserProvider {
  descriptor(): BrowserDescriptor
  createTab(context: BrowserProviderContext, request: BrowserTabRequest): Promise<ProviderTab>
  listAgentTabs(context: BrowserProviderContext): Promise<ProviderTab[]>
  listUserTabs?(context: BrowserProviderContext): Promise<UserTabCandidate[]>
  claimUserTab?(context: BrowserProviderContext, candidate: UserTabCandidate): Promise<ProviderTab>
  execute(context: BrowserProviderContext, tab: ProviderTab, command: BrowserCommand): Promise<BrowserCommandResult>
  show?(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab>
  handoffToUser?(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab>
  resumeControl?(context: BrowserProviderContext, tab: ProviderTab): Promise<ProviderTab>
  release(context: BrowserProviderContext, tab: ProviderTab): Promise<void>
  close(context: BrowserProviderContext, tab: ProviderTab): Promise<void>
  clearData?(): Promise<void>
  manage?(action: 'install' | 'repair' | 'uninstall'): Promise<{ status: 'ready' | 'unavailable' | 'removed'; diagnostic?: string }>
  dispose?(): Promise<void>
}

export interface BrowserStateSnapshot {
  sessionId: string
  revision: number
  browsers: BrowserDescriptor[]
  tabs: BrowserTabState[]
  selectedTabId?: string
}
export interface BrowserSelectionRequest {
  url?: string
  requirements?: BrowserRequirements
  preference?: BrowserPreference
  /** Compatibility input accepted for one release. */
  mode?: 'visible' | 'background' | 'auto'
}

export type BrowserNextAction =
  | { kind: 'ready' }
  | { kind: 'open-in-deepcreator'; tool: 'open_in_deepcreator'; input: { kind: 'browser-tab'; tabId: string } }
  | { kind: 'manual-handoff'; operation: 'handoffToUser'; tabId: string }

export interface BrowserProviderBinding {
  tab: BrowserTabState
  provider: BrowserProvider
  providerTab: ProviderTab
  context: BrowserProviderContext
}
