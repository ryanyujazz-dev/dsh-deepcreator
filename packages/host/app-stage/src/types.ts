/**
 * App Stage public contracts: the manifest v1 application contract, the
 * discovery-entry vocabulary shared by the Host registry and the Client
 * surfaces, and the reason triple every abnormal entry carries.
 *
 * One application is one self-contained directory with `app.json` at its
 * root. The manifest is untrusted display-plus-capability text: every field
 * is validated before an entry can pass the dev gate, and display fields are
 * rendered as plain text by every consumer.
 * @module @ryanyujazz/dsh-app-stage/types
 */

/** The only platform protocol value manifest v1 accepts (v0.0.5). */
export const PLATFORM_PROTOCOL = 'app-stage-v1' as const

/** Directory name an application source directory uses inside a workspace. */
export const APPS_DIR = '.deepcreator/apps'

/** One declared action in a manifest's `actions` list. */
export interface AppActionDecl {
  /** camelCase, unique within the application. */
  readonly name: string
  /** Tool-facing description: when to use / what it does / param meanings, ≤120 chars. */
  readonly description: string
  /** AppData key paths this action writes (≤8). */
  readonly persist?: readonly string[]
  /** Loose scalar params: `string | number | boolean | json`, `?` suffix marks optional. */
  readonly params?: Readonly<Record<string, string>>
}

/** The validated manifest v1 shape (post-gate; defaults applied). */
export interface AppManifest {
  readonly id: string
  readonly platform: typeof PLATFORM_PROTOCOL
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly icon?: string
  readonly entry: string
  readonly dev: boolean
  readonly agentGuide?: string
  readonly dataVersion?: string
  readonly actions: readonly AppActionDecl[]
  readonly permissions: readonly []
}

/** Machine-readable cause of an abnormal entry (diagnosis protocol). */
export interface AppEntryReason {
  /** One of the machine-enumerated causes. */
  readonly code: AppEntryReasonCode
  /** English detail with a JSON path locating the offense. */
  readonly detail: string
  /** One-sentence fix direction. */
  readonly fix: string
}

/** Reason codes of the diagnosis protocol (`app_list` / entry lists). */
export type AppEntryReasonCode =
  | 'manifest.invalid'
  | 'gate.incomplete'
  | 'runtime.broken'
  | 'platform.unsupported'

/** Entry health: `ready` may open; every other value must carry a reason. */
export type AppEntryStatus = 'ready' | 'incomplete' | 'rejected' | 'broken'

/** One dev entry as the Client dev menu and `app_list` see it. */
export interface AppDevEntry {
  readonly scope: 'dev'
  /** The app id (directory name under `.deepcreator/apps/`). */
  readonly appId: string
  readonly status: AppEntryStatus
  readonly manifest?: AppManifest
  readonly reason?: AppEntryReason
  /** Ready-only lazily-provisioned sandbox origin (empty until `ensure`). */
  readonly originURL?: string
  /** The same id exists in the installed store (menu comparison marker). */
  readonly conflictsWithInstalled: boolean
}

/** One installed entry as the Launcher and `app_list` see it. */
export interface AppInstalledEntry {
  readonly scope: 'installed'
  readonly appId: string
  readonly status: AppEntryStatus
  readonly manifest?: AppManifest
  readonly reason?: AppEntryReason
  readonly originURL?: string
  /** Launcher blue dot: installed version is newer than the last opened one. */
  readonly updatedSinceOpen?: boolean
  /** `current.json` pointer facts (absent on broken installs). */
  readonly pointer?: {
    readonly version: string
    readonly digest: string
    readonly installedAt: string
    readonly sourceWorkspace: string
    readonly sourceFingerprint: string
    readonly publishedVia: string
  }
}

/** The `list` result: installed is global; dev is the caller's workspace. */
export interface AppStageList {
  readonly installed: readonly AppInstalledEntry[]
  readonly dev: readonly AppDevEntry[]
}

/** Discriminated wire results for the remote face. */
export type AppStageListResult =
  | { readonly ok: true; readonly list: AppStageList }
  | { readonly ok: false; readonly code: 'NO_WORKSPACE'; readonly message: string }

export type AppStageEnsureResult =
  | { readonly ok: true; readonly url: string; readonly entry: AppDevEntry | AppInstalledEntry }
  | {
      readonly ok: false
      readonly code: 'NOT_FOUND' | 'NOT_READY' | 'NO_WORKSPACE' | 'SERVE_FAILED'
      readonly message: string
    }

/** Arbitrary lossless-JSON value — the data bridge carries structured documents. */
export type AppJsonValue = string | number | boolean | null | readonly AppJsonValue[] | { readonly [key: string]: AppJsonValue }

/** One key-path AppData journal entry as the bridge and tools see it. */
export interface AppDataChange {
  readonly rev: number
  readonly path: string
  readonly value: AppJsonValue
  readonly causeId: string
  readonly ts: string
}

export type AppStageDataGetResult =
  | { readonly ok: true; readonly value: AppJsonValue; readonly rev: number }
  | { readonly ok: false; readonly code: 'NOT_FOUND' | 'NOT_READY' | 'NO_WORKSPACE' | 'PATH_INVALID'; readonly message: string }

export type AppStageDataSetResult =
  | { readonly ok: true; readonly rev: number }
  | {
      readonly ok: false
      readonly code: 'NOT_FOUND' | 'NOT_READY' | 'NO_WORKSPACE' | 'PATH_INVALID' | 'VALUE_TOO_LARGE' | 'DOC_TOO_LARGE'
      readonly message: string
    }

export type AppStageDataChangesResult =
  | { readonly ok: true; readonly changes: readonly AppDataChange[]; readonly rev: number }
  | { readonly ok: false; readonly code: 'NOT_FOUND' | 'NOT_READY' | 'NO_WORKSPACE'; readonly message: string }

/** The eleven publish-gate failure codes (v0.0.5 enumeration, frozen). */
export type AppPublishFailureCode =
  | 'APP_NOT_FOUND'
  | 'DEV_GATE_FAILED'
  | 'MANIFEST_INVALID'
  | 'PACKAGE_TOO_LARGE'
  | 'ID_CONFLICT'
  | 'USER_DECLINED'
  | 'VERSION_NOT_BUMPED'
  | 'VERSION_DOWNGRADED'
  | 'SOURCE_MISSING'
  | 'PROBE_FAILED'
  | 'STORE_WRITE_FAILED'

/** Zero-external scan finding: one locating fact about one offense. */
export interface AppScanViolation {
  /** File path inside the snapshot (forward slashes, snapshot-relative). */
  readonly file: string
  /** `absolute-url` | `navigation-api`. */
  readonly kind: 'absolute-url' | 'navigation-api'
  /** The offending text (trimmed to a bounded snippet). */
  readonly snippet: string
}

/** Staging machine-probe report (browser-backed; screenshot may degrade). */
export interface AppProbeReport {
  readonly ok: boolean
  /** Entry fetch + MIME check outcome. */
  readonly entryLoaded: boolean
  /** AppData keys the staging instance subscribed to over the bridge (channel 2). */
  readonly subscribedKeys: readonly string[]
  /** Action names the staging instance registered over the bridge (channel 1). */
  readonly registeredActions: readonly string[]
  /** Page console errors captured during the probe. */
  readonly consoleErrors: readonly string[]
  /** Whether the first-paint screenshot was captured (degrades to icon+name). */
  readonly screenshotTaken: boolean
  /** Human-readable failure summary when `ok` is false. */
  readonly detail?: string
}

/** The full publish report the approval card and tool result share. */
export interface AppPublishReport {
  readonly appId: string
  readonly name: string
  readonly version: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly digest: string
  readonly scan: { readonly violations: readonly AppScanViolation[] }
  readonly probe: AppProbeReport
}

/** Install plan resolved from version + source-fingerprint policy. */
export type AppPublishPlan =
  | 'first'
  | 'update-same-source'
  | 'update-cross-source'

export type AppStagePublishPrepareResult =
  | {
      readonly ok: true
      readonly draftToken: string
      readonly plan: AppPublishPlan
      readonly previous?: {
        readonly version: string
        readonly sourceWorkspace: string
      }
      readonly report: AppPublishReport
    }
  | { readonly ok: false; readonly code: AppPublishFailureCode; readonly message: string }

export type AppStagePublishCommitResult =
  | { readonly ok: true; readonly appId: string; readonly version: string; readonly plan: AppPublishPlan }
  | { readonly ok: false; readonly code: AppPublishFailureCode; readonly message: string }

export type AppStageUninstallResult =
  | { readonly ok: true; readonly appId: string; readonly removed: true }
  | { readonly ok: false; readonly code: 'APP_NOT_INSTALLED' | 'STORE_WRITE_FAILED'; readonly message: string }

// ---------------------------------------------------------------------------
// M4 — the operation face: invoke routing, presentation, router wire types.

/** One request the GUI router executes inside a Stage container (M4). */
export interface AppRouterRequest {
  readonly kind: 'invoke' | 'open'
  readonly requestId: string
  readonly appId: string
  readonly version: string
  /** The manifest's human-facing name (activity-chip copy falls back to appId). */
  readonly name?: string
  /** invoke only: the declared action name. */
  readonly action?: string
  /** invoke only: the validated params object. */
  readonly params?: AppJsonValue
  /** open only: additionally switch the user into apps mode. */
  readonly focus?: boolean
}

/** The router's outcome for one dispatched request (wire form). */
export interface AppRouterOutcome {
  /** invoke only: the handler's return value, when it returned one. */
  readonly result?: AppJsonValue
  /** Failure detail from the frame (untrusted app text) or the router itself. */
  readonly error?: { readonly code?: string; readonly message: string }
  /** open only: whether the router had to mount the container. */
  readonly opened?: boolean
  /** open only: whether the user's view was switched. */
  readonly focused?: boolean
}

/** `app_invoke` (B3): the structured command channel into a Stage container. */
export type AppStageInvokeResult =
  | {
    readonly ok: true
    readonly appId: string
    readonly version: string
    readonly action: string
    readonly result?: AppJsonValue
    readonly persistedKeys: readonly string[]
  }
  | {
    readonly ok: false
    readonly code:
      | 'APP_NOT_INSTALLED'
      | 'ACTION_NOT_DECLARED'
      | 'PARAMS_MISMATCH'
      | 'ACTION_NOT_REGISTERED'
      | 'HANDLER_FAILED'
      | 'INVOKE_TIMEOUT'
      | 'CONTAINER_UNAVAILABLE'
      | 'CIRCUIT_OPEN'
      | 'RUNTIME_BROKEN'
    readonly message: string
    /** INVOKE_TIMEOUT context: whether AppData advanced during the window. */
    readonly actionApplied?: boolean
  }

/** `app_open` (B4): presentation intent — ensure the container, maybe focus. */
export type AppStageOpenResult =
  | { readonly ok: true; readonly appId: string; readonly version: string; readonly opened: boolean; readonly focused: boolean }
  | { readonly ok: false; readonly code: 'APP_NOT_INSTALLED' | 'CONTAINER_UNAVAILABLE' | 'RUNTIME_BROKEN'; readonly message: string }

/** The long-poll face the GUI router drives (`waitRouterRequests`). */
/** One listed runtime asset (B10). */
export interface AppStageAssetEntry {
  readonly name: string
  readonly url: string
  readonly mediaType: string
  readonly bytes: number
  readonly updatedAt: string
}

/** `app_asset_write` outcome (B9): the upsert receipt or a deterministic failure. */
export type AppStageAssetWriteResult =
  | { ok: true; appId: string; name: string; url: string; mediaType: string; bytes: number; overwritten: boolean; quotaUsedBytes: number }
  | { ok: false; code: 'APP_NOT_INSTALLED' | 'SOURCE_PATH_INVALID' | 'SOURCE_NOT_FOUND' | 'NAME_INVALID' | 'MIME_UNSUPPORTED' | 'ASSET_TOO_LARGE' | 'ASSET_QUOTA_EXCEEDED' | 'STORE_WRITE_FAILED'; message: string }

/** `app_asset_list` outcome (B10): the app's assets and quota usage. */
export type AppStageAssetListResult =
  | { ok: true; appId: string; assets: AppStageAssetEntry[]; quotaUsedBytes: number; quotaLimitBytes: number }
  | { ok: false; code: 'APP_NOT_INSTALLED'; message: string }

export type AppStageWaitRequestsResult =
  | { readonly ok: true; readonly requests: readonly AppRouterRequest[]; readonly cursor: number }
  | { readonly ok: false; readonly code: 'NO_WORKSPACE'; readonly message: string }

/** The router's completion report face (`routerResult`). */
export type AppStageRouterResultAck =
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly code: 'UNKNOWN_REQUEST'; readonly message: string }

// ---------------------------------------------------------------------------
// M5 — presence remotes (Px-β): lease snapshots, timeline feed, user controls.

/** `presenceSnapshot`: live leases for the caller's session (render states derive). */
export type AppStagePresenceSnapshotResult =
  | { readonly ok: true; readonly leases: readonly import('./presence.ts').PresenceLeaseSnapshot[] }
  | { readonly ok: false; readonly code: 'NO_WORKSPACE'; readonly message: string }

/** `presenceTimeline`: installed-origin activity rows after a cursor. */
export type AppStagePresenceTimelineResult =
  | { readonly ok: true; readonly rows: readonly import('./presence.ts').PresenceTimelineRow[]; readonly latest: number }
  | { readonly ok: false; readonly code: 'NO_WORKSPACE'; readonly message: string }

/** `presenceSummary`: one emitted lease summary (late fetch by lease id). */
export type AppStagePresenceSummaryResult =
  | { readonly ok: true; readonly summary: import('./presence.ts').PresenceSummary }
  | { readonly ok: false; readonly code: 'UNKNOWN_LEASE'; readonly message: string }

/** `presenceControl`: user-side lease controls (interrupt / resume / handback). */
export type AppStagePresenceControlResult =
  | { readonly ok: true; readonly applied: boolean }
  | { readonly ok: false; readonly code: 'NO_WORKSPACE' | 'OP_INVALID'; readonly message: string }
