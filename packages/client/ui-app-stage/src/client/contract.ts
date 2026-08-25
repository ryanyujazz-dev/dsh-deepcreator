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
import type { AppStageDataChangesResult, AppStageDataGetResult, AppStageDataSetResult, AppStageEnsureResult, AppJsonValue, AppStageListResult } from '@ryanyujazz/dsh-app-stage/types'

/** The remote namespace face the shell captures once in apply. */
export interface AppStageRemote {
  list: (sessionId: SessionId) => Promise<RemoteResult<AppStageListResult>>
  ensure: (sessionId: SessionId, ref: string) => Promise<RemoteResult<AppStageEnsureResult>>
  dataGet: (sessionId: SessionId, ref: string, path?: string) => Promise<RemoteResult<AppStageDataGetResult>>
  dataSet: (sessionId: SessionId, ref: string, path: string, value: AppJsonValue, causeId: string) => Promise<RemoteResult<AppStageDataSetResult>>
  dataChanges: (sessionId: SessionId, ref: string, sinceRev: number) => Promise<RemoteResult<AppStageDataChangesResult>>
  uninstall: (sessionId: SessionId, appId: string) => Promise<RemoteResult<{ ok: true; appId: string; removed: true } | { ok: false; code: string; message: string }>>
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
  /**
   * Sandbox data bridge attach: bind the relay to a live container frame and
   * its data ref (`dev:<appId>` / installed id); the returned disposer
   * detaches with the container.
   */
  readonly bridge: (frame: HTMLIFrameElement, ref: string) => () => void
}

/** Full composed props of the Stage Shell occupant. */
export type StageShellProps =
  & PropsRuntime<'deepcreator.stage.apps'>
  & PropsLocale<'app-stage'>
  & StageShellInjected
