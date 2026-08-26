/**
 * Wire-layer contracts for the App Stage shell: the composed props the
 * occupant registers with, and the narrow client-side view of the resident
 * host registry's remote face (the wire types come from the host package;
 * they are re-declared here only where the Client renders them).
 * @module @ryanyujazz/dsh-client-ui-app-stage/client/contract
 */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-client-ui-layout/client'
import type { AppRouterOutcome, AppStageDataChangesResult, AppStageDataGetResult, AppStageDataSetResult, AppStageEnsureResult, AppStagePresenceControlResult, AppStagePresenceSnapshotResult, AppStagePresenceSummaryResult, AppStagePresenceTimelineResult, AppStageRollbackResult, AppJsonValue, AppStageListResult, AppStageRouterResultAck, AppStageWaitRequestsResult } from '@ryanyujazz/dsh-app-stage/types'
import type { AppHistoryRecord, AppImportSource, AppStageImportCommitResult, AppStageImportPrepareResult, AppWatermark } from '@ryanyujazz/dsh-app-stage/types'

/** The remote namespace face the shell captures once in apply. */
export interface AppStageRemote {
  list: (sessionId: SessionId) => Promise<RemoteResult<AppStageListResult>>
  ensure: (sessionId: SessionId, ref: string) => Promise<RemoteResult<AppStageEnsureResult>>
  dataGet: (sessionId: SessionId, ref: string, path?: string) => Promise<RemoteResult<AppStageDataGetResult>>
  dataSet: (sessionId: SessionId, ref: string, path: string, value: AppJsonValue, causeId: string) => Promise<RemoteResult<AppStageDataSetResult>>
  dataChanges: (sessionId: SessionId, ref: string, sinceRev: number) => Promise<RemoteResult<AppStageDataChangesResult>>
  uninstall: (sessionId: SessionId, appId: string) => Promise<RemoteResult<{ ok: true; appId: string; removed: true } | { ok: false; code: string; message: string }>>
  /**
   * Park until requests land after `afterCursor`. `routerId` names this
   * surface; the hub delivers each request to exactly one connected router.
   */
  waitRouterRequests: (sessionId: SessionId, afterCursor: number, routerId: string) => Promise<RemoteResult<AppStageWaitRequestsResult>>
  routerResult: (sessionId: SessionId, requestId: string, outcome: AppRouterOutcome) => Promise<RemoteResult<AppStageRouterResultAck>>
  /** M5: live lease snapshots for this session (the banner/border projection). */
  presenceSnapshot: (sessionId: SessionId) => Promise<RemoteResult<AppStagePresenceSnapshotResult>>
  /** M5: user-side lease controls (interrupt / resume / handback). */
  presenceControl: (sessionId: SessionId, op: 'interrupt' | 'resume' | 'handback') => Promise<RemoteResult<AppStagePresenceControlResult>>
  /** M5: one emitted lease summary (the handing-back card material). */
  presenceSummary: (sessionId: SessionId, leaseId: string) => Promise<RemoteResult<AppStagePresenceSummaryResult>>
  /** M5e: the global installed-origin activity feed after a cursor. */
  presenceTimeline: (sessionId: SessionId, sinceSeq: number) => Promise<RemoteResult<AppStagePresenceTimelineResult>>
  /** M6b: the install history + rollback baseline (user detail view). */
  installedHistory: (sessionId: SessionId, appId: string) => Promise<RemoteResult<{ ok: true; records: readonly AppHistoryRecord[]; watermark?: AppWatermark } | { ok: false; code: 'NO_WORKSPACE'; message: string }>>
  /** M6b: roll the current pointer back to a history version (user action). */
  rollbackInstalled: (sessionId: SessionId, appId: string, version: string) => Promise<RemoteResult<AppStageRollbackResult>>
  /** M6c: stage + probe + plan an import; the facts card confirms before commit. */
  importPrepare: (sessionId: SessionId, source: AppImportSource) => Promise<RemoteResult<AppStageImportPrepareResult>>
  /** M6c: install a confirmed import draft. */
  importCommit: (sessionId: SessionId, draftToken: string) => Promise<RemoteResult<AppStageImportCommitResult>>
  /** M6c: drop a staged import draft. */
  importAbort: (sessionId: SessionId, draftToken: string) => Promise<RemoteResult<{ ok: true; dropped: boolean }>>
  /** M5d: the global timeline watermark (seen + head in one read). */
  presenceSeen: (sessionId: SessionId) => Promise<RemoteResult<{ ok: true; seen: number; latest: number }>>
  /** M5d: advance the watermark (clears the activity blue dot). */
  presenceMarkSeen: (sessionId: SessionId, seq: number) => Promise<RemoteResult<{ ok: true; seen: number }>>
}

/** The facts card an import shows before its confirm (M6c). */
export interface ImportFacts {
  readonly draftToken: string
  readonly plan: string
  readonly appId: string
  readonly name: string
  readonly version: string
  readonly via: 'import' | 'import:git'
  readonly label: string
  readonly installedVersion?: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly digest: string
}

/** One install-history row in the detail view (M6b). */
export interface HistoryRow {
  readonly version: string
  readonly digest: string
  readonly at: string
  readonly publishedVia: string
  readonly sourceWorkspace: string
}

/** One timeline row in the activity view (the shell renders these). */
export interface ActivityRow {
  readonly ts: number
  readonly seq: number
  readonly appId: string
  readonly appName: string
  readonly version?: string
  readonly kind: string
  readonly action?: string
  readonly outcome: string
  readonly durationMs: number
}

/** One dev-menu row after the host's gate (view-model form). */
export interface DevMenuRow {
  readonly appId: string
  readonly name: string
  readonly version: string
  readonly ready: boolean
  readonly reason?: { code: string; detail: string; fix: string }
  readonly conflictsWithInstalled: boolean
}

/** One launcher card (installed entries; M3 adds source, dot, removal). */
export interface LauncherCard {
  readonly appId: string
  readonly name: string
  readonly version: string
  readonly description?: string
  /** Blue dot: installed version newer than the last opened one. */
  readonly updated?: boolean
  /** Human-readable origin workspace name (source annotation). */
  readonly sourceWorkspace?: string
  readonly installedAt?: string
}

/** The open sandbox container (one at a time in M1). */
export interface OpenContainer {
  readonly appId: string
  readonly name: string
  readonly version: string
  readonly url: string
  readonly dev: boolean
  /** Data-domain reference the bridge addresses for this container. */
  readonly ref: string
}

/** The shell's own injected share: faces the frame does not own. */
export interface StageShellInjected {
  /** Writes back through ctx.layout (dock toggle, mode exit). */
  readonly layout: {
    setDockOpen(open: boolean): void
    setStageMode(mode: 'conversation' | 'apps'): void
  }
  /** Captured remote namespace (apply captures once — render never reads ctx). */
  readonly remote: AppStageRemote
  /** Live current-session feed (registration-time props are static; the dev
   * scope follows the shared sessions list through useSyncExternalStore). */
  readonly sessions: {
    subscribe(listener: () => void): () => void
    getSnapshot(): SessionId | undefined
  }
  /** Refresh hint channel: bump to rescan (probe-at-open). */
  readonly scanTick: number
  /** The M4 operation router: executes app_invoke/app_open requests against
   * the live container and owns the shell's container store (the bridge
   * travels inside it — the shell never relays frames itself). */
  readonly router: import('./router.ts').StageRouterApi
  /** M5: the presence projection feed (banner/frame/summary render from it). */
  readonly presence: import('./presence.ts').PresenceFeedApi
  /** M5e: activity-unread tick (bumps when a command settles anywhere). */
  readonly activityTick: number
}

/** Full composed props of the Stage Shell occupant. */
export type StageShellProps =
  & PropsRuntime<'deepcreator.stage.apps'>
  & PropsLocale<'app-stage'>
  & StageShellInjected
