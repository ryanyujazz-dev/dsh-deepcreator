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
  | 'TAB_NOT_FOUND' | 'TAB_NOT_OWNED' | 'STALE_SNAPSHOT' | 'CONTROL_INTERRUPTED'
  | 'NAVIGATION_BLOCKED' | 'APPROVAL_DENIED' | 'AUTH_REQUIRED' | 'TIMEOUT'
  | 'PAGE_CRASHED' | 'PRESENTATION_UNAVAILABLE' | 'PROFILE_LOCKED'
  | 'PLAYWRIGHT_COMPILE_ERROR' | 'PLAYWRIGHT_RUNTIME_ERROR' | 'PLAYWRIGHT_POLICY_BLOCKED'

export type BrowserRemoteResult<T> = { ok: true; value: T } | { ok: false; code: BrowserErrorCode; message: string }

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
  snapshotArtifactId?: string
  /** Client-only hydrated preview. Host state snapshots carry snapshotArtifactId instead. */
  snapshotImageDataUrl?: string
  lastAction?: { action: string; at: number; result: 'ok' | BrowserErrorCode }
}

export interface BrowserNodeRef {
  nodeRef: string
  role?: string
  name?: string
  value?: string
  inputType?: string
  autocomplete?: string
}
export interface BrowserSnapshot { snapshotId: string; url: string; title: string; text: string; nodes: BrowserNodeRef[] }
export type BrowserLocator =
  | { kind: 'node'; snapshotId: string; nodeRef: string }
  | { kind: 'role'; role: string; name?: string }
  | { kind: 'text'; text: string; exact?: boolean }
  | { kind: 'label'; label: string }

export type BrowserCommand =
  | { kind: 'navigate'; action: 'goto' | 'back' | 'forward' | 'reload'; url?: string }
  | { kind: 'inspect'; action: 'snapshot' | 'screenshot' | 'url' | 'title' | 'elementInfo'; locator?: BrowserLocator }
  | { kind: 'act'; action: 'click' | 'fill' | 'type' | 'press' | 'select' | 'check' | 'scroll' | 'drag' | 'upload'; locator?: BrowserLocator; destination?: BrowserLocator; value?: string; files?: string[]; expected?: 'none' | 'navigation' | 'download' }
  | { kind: 'wait'; condition: 'url' | 'load' | 'visible' | 'hidden' | 'dialog'; value?: string; locator?: BrowserLocator; timeoutMs?: number }

export type BrowserCommandResult =
  | { kind: 'state'; tab: ProviderTab }
  | { kind: 'snapshot'; snapshot: BrowserSnapshot; tab: ProviderTab }
  | { kind: 'screenshot'; dataUrl: string; tab: ProviderTab }
  | { kind: 'elementInfo'; element: BrowserNodeRef; tab: ProviderTab }
  | { kind: 'download'; artifactId: string; fileName: string; tab: ProviderTab }

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
  browserId?: string
  /** Compatibility input accepted for one release. */
  capabilities?: BrowserCapability[]
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
