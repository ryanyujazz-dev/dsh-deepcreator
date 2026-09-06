/**
 * Resident App Stage host plugin.
 *
 * Owns the user-level, person-scoped App Stage surfaces: the discovery
 * registry (install store + workspace dev copies, completeness-gated), the
 * dual-source sandboxed static origins on the official loopback webServer,
 * the AppData domain layout skeleton, and the app-stage agent-preset
 * materializer. Lifecycle = this row's fiber; every registration is
 * reversible and the row's removal withdraws the whole stage (plugin
 * integrity invariant).
 * @module @ryanyujazz/dsh-app-stage
 */
import { randomUUID } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import type { AppDataChange, AppDevEntry, AppInstalledEntry, AppJsonValue, AppManifest, AppPublishPlan, AppRouterOutcome, AppStageAssetListResult, AppStageAssetWriteResult, AppStageDataChangesResult, AppStageDataGetResult, AppStageDataSetResult, AppStageEnsureResult, AppStageHistoryResult, AppStageInvokeResult, AppStageRollbackResult, AppStageListResult, AppStageOpenResult, AppStagePresenceControlResult, AppStagePresenceSnapshotResult, AppStagePresenceSummaryResult, AppStagePresenceTimelineResult, AppStagePublishCommitResult, AppStagePublishPrepareResult, AppStageRouterResultAck, AppStageUninstallResult, AppStageWaitRequestsResult, AppStageImportAbortResult, AppStageImportCommitResult, AppStageImportPrepareResult, AppStageAssetDeleteResult } from './types.ts'
import { AppStageStaticServer } from './serve.ts'
import { listInstalled, gateDevEntry, scanDevRoot } from './registry.ts'
import { dshHome, readActivitySeen, readInstallPointer, readOpenedVersions, recordOpenedVersion, storeRoot, writeActivitySeen } from './store.ts'
import { ensurePreset } from './preset.ts'
import { AppStageWatcherSet } from './watcher.ts'
import { appDataChanges, appDataGet, appDataSet, migrateDevDataToInstalled } from './appdata.ts'
import { buildReport, commitSnapshot, gateForPublish, hashSnapshot, PACKAGE_MAX_BYTES, publishFingerprint, readHistory, readStagedManifest, readWatermark, resolvePlan, rollbackInstalled, stageSnapshot, uninstallApp, withInstallLock, writeInstallPointer } from './publish.ts'
import { hardenedClone, resolveImportPlan } from './import.ts'
import { validateManifestBytes } from './manifest.ts'
import { probeStaging } from './probe.ts'
import { AppRouterHub, INVOKE_TIMEOUT_MS, OPEN_TIMEOUT_MS } from './control.ts'
import { PresenceCoordinator, PRESENCE_MACRO_AI_BUDGET_MS, PRESENCE_MACRO_DELEGATED_BUDGET_MS, summarizeParams } from './presence.ts'
import { deleteAsset, listAssets, removeAssets, writeAsset } from './assets.ts'
import { validateInvokeParams } from './params.ts'
import { preinstallBuiltin } from './builtin.ts'

export * from './types.ts'
export { validateManifest, validateManifestBytes, MANIFEST_MAX_BYTES } from './manifest.ts'
export { dshHome, storeRoot, installedVersionDir } from './store.ts'
export { scanDevRoot, gateDevEntry, listInstalled, devRootFor } from './registry.ts'
export { AppStageStaticServer, APP_STAGE_PREFIX, APP_CSP } from './serve.ts'
export { agentEntryUrl, ensurePreset, APP_STAGE_PRESET_ID, presetCompositionPath, presetStampPath } from './preset.ts'
export { AppStageWatcherSet, WATCH_DEBOUNCE_MS, WATCH_FALLBACK_MS } from './watcher.ts'
export {
  appDataChanges, appDataGet, appDataSet, appDataDrop, appDataDir, getPath as appDataGetPath,
  VALUE_MAX_BYTES, DOC_MAX_BYTES, JOURNAL_KEEP, CHANGES_MAX, workspaceToken,
} from './appdata.ts'
export {
  compareVersions, resolvePlan, listSnapshotFiles, scanZeroExternal, hashSnapshot, stageSnapshot,
  writeInstallPointer, commitSnapshot, uninstallApp, buildReport, readStagedManifest, gateForPublish,
  publishFingerprint, PACKAGE_MAX_BYTES, SCAN_VIOLATIONS_MAX,
} from './publish.ts'
export { probeStaging, PROBE_SUBSCRIBE_WAIT_MS, PROBE_LOAD_TIMEOUT_MS } from './probe.ts'
export { AppRouterHub, ROUTER_POLL_MS, INVOKE_TIMEOUT_MS, OPEN_TIMEOUT_MS, ROUTER_PRESENCE_GRACE_MS, ROUTER_SEEN_WINDOW_MS } from './control.ts'
export type { RoutedSettlement } from './control.ts'
export { PresenceCoordinator, PRESENCE_IDLE_SUSPEND_MS, PRESENCE_MACRO_AI_BUDGET_MS, PRESENCE_MACRO_DELEGATED_BUDGET_MS, PRESENCE_BANNER_HYSTERESIS_MS } from './presence.ts'
export type { PresenceLeaseState, PresenceLeaseSnapshot, PresenceSummary, PresenceTimelineRow, PresenceActionRecord, PresenceCommandKind } from './presence.ts'
export { validateInvokeParams } from './params.ts'
export {
  ASSET_MEDIA_TYPES, ASSET_NAME_PATTERN, ASSET_QUOTA_BYTES, ASSET_MAX_BYTES, ASSETS_ROUTE, assetUrl, assetsDir, deleteAsset, listAssets, removeAssets, writeAsset, ORPHAN_WINDOW_MS, scanOrphanAssets,
} from './assets.ts'
export { readOpenedVersions, recordOpenedVersion } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { appStage: AppStageService }
}

export const inject = ['webServer', 'workspaceRegistry', 'sessions']

/** One staged import draft held between `importPrepare` and its commit (M6c). */
interface ImportDraft {
  readonly appId: string
  readonly stagingDir: string
  readonly manifest: AppManifest
  readonly digest: string
  readonly plan: ReturnType<typeof resolveImportPlan>
  readonly via: 'import' | 'import:git'
  readonly label: string
  readonly fingerprint: string
  readonly sourceSession: string
}

/** One staged publish draft held between `preparePublish` and the commit. */
interface PublishDraft {
  readonly appId: string
  readonly stagingDir: string
  readonly manifest: AppManifest
  readonly fingerprint: string
  readonly plan: AppPublishPlan
  readonly sourceWorkspace: string
  readonly sourceSession: string
  readonly sourceCwd: string
  readonly digest: string
  /** M6e: user ticked "carry dev data over" on the approval card (first-install flows). */
  readonly migrateData: boolean
}

/**
 * The resident App Stage service (`ctx.appStage`): the discovery face the
 * Client shells call (probe-at-open refresh + the session-bound watcher set),
 * the AppData bridge endpoints, the publish chain (prepare/commit/abort +
 * uninstall), and boot-time preset materialization.
 */
export class AppStageService extends TypertRemoteService {
  static inject = inject
  private readonly statics: AppStageStaticServer
  /** Session-bound dev watcher set: one recursive watcher per bound workspace. */
  readonly watchers: AppStageWatcherSet
  /** Staged publish drafts by token (approval window state; host-lifetime). */
  private readonly publishDrafts = new Map<string, PublishDraft>()
  private readonly importDrafts = new Map<string, ImportDraft>()
  /** The M4 operation face's routing hub (long-polled by the GUI router). */
  private readonly router = new AppRouterHub()
  /** The M5 presence coordinator (Px-β): authoritative lease state. */
  private readonly presence = new PresenceCoordinator()

  constructor(ctx: Context) {
    super(ctx, 'appStage')
    this.statics = new AppStageStaticServer(ctx.webServer)
    this.statics.setPresenceSource(this.presence)
    this.watchers = new AppStageWatcherSet(ctx)
    ctx.effect(() => () => this.statics.dispose(), 'app-stage: static origins')
    ctx.effect(() => {
      // Adopt sessions that were already live when this row loaded, then
      // follow the real binding source: session creation and disposal.
      for (const live of ctx.sessions.list()) {
        const cwd = live.header.cwd
        if (cwd !== undefined) this.watchers.bind(cwd)
      }
      const created = ctx.on('session/created', session => {
        const cwd = session.header.cwd
        if (cwd !== undefined) this.watchers.bind(cwd)
      })
      const disposed = ctx.on('session/disposed', session => {
        const cwd = session.header.cwd
        if (cwd !== undefined) this.watchers.unbind(cwd)
      })
      const presenceUnbind = ctx.on('session/disposed', session => {
        this.presence.sessionDisposed(String(session.id))
      })
      return () => {
        created()
        disposed()
        presenceUnbind()
        this.watchers.dispose()
        this.presence.dispose()
      }
    }, 'app-stage: session-bound dev watchers')
    // Generated property, not state: materialize + verify on boot; no
    // disposer needed (the files outlive the row and are re-verified next boot).
    void this.materializePreset().catch(error => {
      this.ctx.logger.warn(`app-stage preset materialization failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    // Factory preinstall (v0.0.5): the sample app fills an empty desktop on
    // first boot; a user uninstall stays honored until the id reappears by a
    // real publish.
    void this.preinstallBuiltin().catch(error => {
      this.ctx.logger.warn(`app-stage builtin preinstall failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** Materialize (or verify + heal) the app-stage agent preset. */
  async materializePreset(home: string = dshHome()): Promise<'materialized' | 'verified' | 'healed'> {
    const presetsRoot = `${home}/.agent-presets`
    return ensurePreset(presetsRoot, message => this.ctx.logger.warn(message))
  }

  /** Preinstall the sample app when its id is absent from the install store. */
  async preinstallBuiltin(home: string = dshHome()): Promise<'installed' | 'already-present' | 'failed'> {
    return preinstallBuiltin(home, join(storeRoot(home), 'apps', 'staging'))
  }

  /** Ready-entry sandbox URL for a dev source directory. */
  devOriginURL(dir: string, entry: string): string {
    return this.statics.urlForDev(dir, entry)
  }

  /** Sandbox URL for an installed snapshot. */
  installedOriginURL(appId: string, version: string, entry: string): string {
    return this.statics.urlForInstalled(appId, version, entry)
  }

  /** The discovery face: installed (global) + dev (caller's workspace). */
  @Remote('list')
  async list(session: Session): Promise<AppStageListResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    const home = dshHome()
    const installed = await listInstalled(home)
    const opened = await readOpenedVersions(home)
    const withDots = installed.map(entry => ({
      ...entry,
      ...(entry.status === 'ready' && entry.pointer !== undefined && opened[entry.appId] !== entry.pointer.version ? { updatedSinceOpen: true } : {}),
    }))
    const installedIds = new Set(withDots.map(entry => entry.appId))
    const dev = await scanDevRoot(cwd, installedIds)
    return { ok: true, list: { installed: withDots, dev } }
  }

  /**
   * Probe-at-open: re-gate the referenced entry and mint its sandbox URL.
   * `ref` is a bare installed app id or `dev:<appId>` (the caller's own
   * workspace is the dev scope — `dev:workspaceId:appId` qualification lands
   * with the M2 multi-workspace tool face).
   */
  @Remote('ensure')
  async ensure(session: Session, ref: string): Promise<AppStageEnsureResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    const home = dshHome()
    if (ref.startsWith('dev:')) {
      const appId = ref.slice('dev:'.length)
      const installed = await listInstalled(home)
      const entry = await gateDevEntry(`${cwd}/.deepcreator/apps/${appId}`, appId, installed.some(item => item.appId === appId))
      if (entry.status !== 'ready') {
        return { ok: false, code: 'NOT_READY', message: `${entry.reason?.code ?? 'gate.incomplete'}: ${entry.reason?.detail ?? 'entry is not ready'}` }
      }
      return { ok: true, url: this.statics.urlForDev(`${cwd}/.deepcreator/apps/${appId}`, entry.manifest!.entry), entry }
    }
    const installedEntry = await listInstalled(home)
    const match = installedEntry.find(item => item.appId === ref)
    if (match === undefined) return { ok: false, code: 'NOT_FOUND', message: `No installed app "${ref}".` }
    if (match.status !== 'ready' || match.manifest === undefined || match.pointer === undefined) {
      return { ok: false, code: 'NOT_READY', message: `${match.reason?.code ?? 'runtime.broken'}: ${match.reason?.detail ?? 'installed entry is not ready'}` }
    }
    await recordOpenedVersion(match.appId, match.pointer.version, home)
    return { ok: true, url: this.statics.urlForInstalled(match.appId, match.pointer.version, match.manifest.entry), entry: match }
  }

  /**
   * Resolve a data-domain reference against the caller's session: `dev:<appId>`
   * addresses the session workspace's dev copy (re-gated on every call);
   * a bare appId addresses the installed store. Returns the domain facts the
   * bridge endpoints need.
   */
  private async resolveDataRef(
    session: Session, ref: string,
  ): Promise<{ ok: true; scope: 'installed' | 'dev'; appId: string; cwd?: string; schemaVersion: string } | { ok: false; code: 'NOT_FOUND' | 'NOT_READY' | 'NO_WORKSPACE'; message: string }> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'NO_WORKSPACE', message: 'This session has no workspace.' }
    const home = dshHome()
    if (ref.startsWith('dev:')) {
      const appId = ref.slice('dev:'.length)
      const dir = `${cwd}/.deepcreator/apps/${appId}`
      const entry = await gateDevEntry(dir, appId, false)
      if (entry.status !== 'ready' || entry.manifest === undefined) {
        return { ok: false, code: 'NOT_READY', message: `${entry.reason?.code ?? 'gate.incomplete'}: ${entry.reason?.detail ?? 'entry is not ready'}` }
      }
      return { ok: true, scope: 'dev', appId, cwd, schemaVersion: entry.manifest.dataVersion ?? '1' }
    }
    const installed = await listInstalled(home)
    const match = installed.find(item => item.appId === ref)
    if (match === undefined) return { ok: false, code: 'NOT_FOUND', message: `No installed app "${ref}".` }
    if (match.status !== 'ready' || match.manifest === undefined) {
      return { ok: false, code: 'NOT_READY', message: `${match.reason?.code ?? 'runtime.broken'}: ${match.reason?.detail ?? 'installed entry is not ready'}` }
    }
    return { ok: true, scope: 'installed', appId: ref, schemaVersion: match.manifest.dataVersion ?? '1' }
  }

  /** Bridge `data.get`: the whole tree or one key path, with the document rev. */
  @Remote('dataGet')
  async dataGet(session: Session, ref: string, path?: string): Promise<AppStageDataGetResult> {
    const resolved = await this.resolveDataRef(session, ref)
    if (!resolved.ok) return resolved
    try {
      const { value, rev } = await appDataGet(resolved.scope, resolved.appId, path, resolved.cwd, resolved.schemaVersion)
      // JSON-safe boundary: a missing key path reads as null (undefined would
      // fail the typert result validation).
      return { ok: true, value: (value === undefined ? null : value) as AppJsonValue, rev }
    } catch (error) {
      return { ok: false, code: 'PATH_INVALID', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * The operation face's read (B5): the bridge `data.get` plus the `found`
   * bit a wire-flattened null cannot express. Not a Remote — the preset
   * tools call it in-process.
   */
  async dataProbe(session: Session, ref: string, path?: string): Promise<{ ok: true; found: boolean; value: AppJsonValue; rev: number } | { ok: false; code: string; message: string }> {
    const resolved = await this.resolveDataRef(session, ref)
    if (!resolved.ok) return resolved
    try {
      const { value, rev } = await appDataGet(resolved.scope, resolved.appId, path, resolved.cwd, resolved.schemaVersion)
      return { ok: true, found: value !== undefined, value: (value === undefined ? null : value) as AppJsonValue, rev }
    } catch (error) {
      return { ok: false, code: 'PATH_INVALID', message: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Bridge `data.set` and the agent's `app_data_write` share this choke
   * point. Presence splits them by causeId prefix: `agent-` writes are
   * command-stream actions (ledger row + lease renewal), `ui-` writes are
   * app effects of a routed command (anti-cover key change list only).
   */
  @Remote('dataSet')
  async dataSet(session: Session, ref: string, path: string, value: AppJsonValue, causeId: string): Promise<AppStageDataSetResult> {
    const resolved = await this.resolveDataRef(session, ref)
    if (!resolved.ok) return resolved
    const startedAt = Date.now()
    const sessionId = String(session.id)
    const agentCommand = causeId.startsWith('agent-')
    if (agentCommand) {
      const name = resolved.scope === 'installed' ? (await this.installedName(resolved.appId)) ?? resolved.appId : resolved.appId
      this.presence.commandStarted(sessionId, { kind: 'data.write', appId: resolved.appId, appName: name, origin: resolved.scope === 'installed' ? 'installed' : 'dev' })
    }
    try {
      const { rev } = await appDataSet(resolved.scope, resolved.appId, path, value, causeId, resolved.cwd, resolved.schemaVersion)
      this.presence.noteKeyChange(sessionId, resolved.appId, path, rev)
      if (agentCommand) {
        const name = resolved.scope === 'installed' ? (await this.installedName(resolved.appId)) ?? resolved.appId : resolved.appId
        this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'data.write', appId: resolved.appId, appName: name, outcome: 'ok', durationMs: Date.now() - startedAt, keys: [path], causeId, origin: resolved.scope === 'installed' ? 'installed' : 'dev' })
      }
      return { ok: true, rev }
    } catch (error) {
      if (agentCommand) {
        const name = resolved.scope === 'installed' ? (await this.installedName(resolved.appId)) ?? resolved.appId : resolved.appId
        this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'data.write', appId: resolved.appId, appName: name, outcome: 'error', durationMs: Date.now() - startedAt, origin: resolved.scope === 'installed' ? 'installed' : 'dev' })
      }
      const message = error instanceof Error ? error.message : String(error)
      const code = message.startsWith('PATH_INVALID') ? 'PATH_INVALID' : message.startsWith('VALUE_TOO_LARGE') ? 'VALUE_TOO_LARGE' : 'DOC_TOO_LARGE'
      return { ok: false, code, message }
    }
  }

  /**
   * The install history + rollback baseline (M6a): version list with digests
   * and the watermark — the activity/history view and the rollback guard's
   * read side. Read-only; mutations only happen through the publish chain.
   */
  @Remote('installedHistory')
  async installedHistory(session: Session, appId: string): Promise<AppStageHistoryResult> {
    void session
    const home = dshHome()
    const records = await readHistory(appId, home)
    const watermark = await readWatermark(appId, home)
    return { ok: true, records, ...(watermark !== undefined ? { watermark } : {}) }
  }

  /** Bridge `data.subscribe` delivery face: journal entries after a rev. */
  @Remote('dataChanges')
  async dataChanges(session: Session, ref: string, sinceRev: number): Promise<AppStageDataChangesResult> {
    const resolved = await this.resolveDataRef(session, ref)
    if (!resolved.ok) return resolved
    // X7: the bridge polls on cadence exactly while the app holds a
    // data.subscribe — this call IS the live subscription fact.
    this.presence.noteAppSubscription(resolved.appId)
    const changes = await appDataChanges(resolved.scope, resolved.appId, sinceRev, resolved.cwd)
    const rev = changes.length > 0 ? changes[changes.length - 1]!.rev : sinceRev
    return { ok: true, changes: changes as readonly AppDataChange[], rev }
  }

  /**
   * Publish gate, mechanical half: locate + gate + version policy + snapshot
   * into a private staging dir + zero-external scan + browser staging probe.
   * The approval ask interleaves in the agent tool between this and
   * `commitPublish`; the staged draft is held in memory keyed by draft token.
   */
  @Remote('preparePublish')
  async preparePublish(session: Session, appId: string): Promise<AppStagePublishPrepareResult> {
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'APP_NOT_FOUND', message: 'This session has no workspace, so there is no dev app to publish.' }
    const home = dshHome()
    const installed = await listInstalled(home)
    const conflicts = installed.some(item => item.appId === appId)
    const gated = await gateForPublish(cwd, appId, conflicts)
    if (!('manifest' in gated)) return { ok: false, code: gated.code, message: gated.message }
    const manifest = gated.manifest
    const pointer = await readInstallPointer(appId, home)
    const fingerprint = publishFingerprint(cwd)
    const stagingDir = join(storeRoot(home), 'apps', 'staging', `${appId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`)
    const staged = await stageSnapshot(gated.dir, stagingDir)
    if ('code' in staged) return { ok: false, code: 'PACKAGE_TOO_LARGE', message: `Snapshot is ${staged.bytes} bytes; the cap is ${PACKAGE_MAX_BYTES}.` }
    // The plan needs the staged digest (same-number-new-digest guard), so it
    // resolves after staging; the watermark + history close the rollback
    // republish hole (M6a).
    const { digest: planDigest } = await hashSnapshot(stagingDir)
    const watermark = await readWatermark(appId, home)
    const historyMap = new Map((await readHistory(appId, home)).map(record => [record.version, record.digest]))
    const plan = resolvePlan(
      manifest.version,
      pointer === undefined ? undefined : { version: pointer.version, sourceFingerprint: pointer.sourceFingerprint },
      fingerprint, watermark, planDigest, historyMap,
    )
    if (typeof plan !== 'string') return { ok: false, code: plan.code, message: plan.code === 'VERSION_NOT_BUMPED' ? `Version ${manifest.version} is already installed; bump the version to publish an update.` : `Version ${manifest.version} is lower than the installed ${pointer!.version}; downgrades are rejected.` }
    const entryURL = `http://${this.ctx.webServer.host}:${this.ctx.webServer.port}${this.statics.urlForDev(stagingDir, manifest.entry)}`
    const probe = await probeStaging({ entryURL, entryMIME: 'text/html', appId, version: manifest.version, declaredActions: manifest.actions.map(action => action.name), home })
    if (!probe.ok) {
      await rm(stagingDir, { recursive: true, force: true })
      return { ok: false, code: 'PROBE_FAILED', message: probe.detail ?? 'staging probe failed' }
    }
    const report = await buildReport(stagingDir, manifest, probe)
    const draftToken = randomUUID()
    this.publishDrafts.set(draftToken, { appId, stagingDir, manifest, fingerprint, plan, sourceWorkspace: basename(cwd), sourceSession: String(session.id), sourceCwd: cwd, digest: report.digest, migrateData: false })
    if (plan !== 'update-same-source') {
      // First publish and cross-source updates wait for the user: the lease
      // projects waiting-approve until approve/decline resolves it.
      this.presence.waitingApprove(String(session.id), appId, manifest.version)
    }
    return {
      ok: true, draftToken, plan,
      ...(pointer === undefined ? {} : { previous: { version: pointer.version, sourceWorkspace: pointer.sourceWorkspace } }),
      report,
    }
  }

  /** Publish commit: move the staged snapshot into the store + pointer write. */
  @Remote('commitPublish')
  async commitPublish(session: Session, draftToken: string, migrateData: boolean): Promise<AppStagePublishCommitResult> {
    void session
    const draft = this.publishDrafts.get(draftToken)
    if (draft === undefined) return { ok: false, code: 'SOURCE_MISSING', message: 'No staged publish draft for this token (it may have been consumed or the host restarted).' }
    this.publishDrafts.delete(draftToken)
    const home = dshHome()
    const still = await readStagedManifest(draft.stagingDir, draft.appId)
    if (still === undefined || still.version !== draft.manifest.version) {
      await rm(draft.stagingDir, { recursive: true, force: true })
      return { ok: false, code: 'SOURCE_MISSING', message: 'The staged snapshot changed during approval; re-run app_publish.' }
    }
    // M6e outcome rides the success payload (absent when not requested).
    let migration: { ok: true; migrated: boolean } | { ok: false; code: string; message: string } | undefined
    try {
      // Serialized with rollback on the same app (audit H1): the commit and
      // a user rollback must never interleave their pointer writes.
      await withInstallLock(draft.appId, async () => {
      await commitSnapshot(draft.stagingDir, draft.appId, draft.manifest.version, home)
      await writeInstallPointer(draft.appId, {
        version: draft.manifest.version, digest: draft.digest, installedAt: new Date().toISOString(),
        sourceWorkspace: draft.sourceWorkspace, sourceFingerprint: draft.fingerprint,
        sourceSession: draft.sourceSession, publishedVia: 'app_publish',
      }, home)
      if (migrateData || draft.migrateData) {
        // First-install flows only: the overwrite case is refused here and
        // surfaced — the user re-decides with the overwrite spelled out.
        migration = await migrateDevDataToInstalled(draft.appId, draft.sourceCwd, home)
      }
      })
    } catch (error) {
      return { ok: false, code: 'STORE_WRITE_FAILED', message: `install store write failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    this.presence.approveResolved(String(session.id), false)
    this.presence.commandSettled(String(session.id), { ts: Date.now(), kind: 'publish', appId: draft.appId, appName: draft.manifest.name, version: draft.manifest.version, outcome: 'ok', durationMs: 0, origin: 'installed' })
    return { ok: true, appId: draft.appId, version: draft.manifest.version, plan: draft.plan, ...(migration === undefined ? {} : { migration }) }
  }

  /**
   * Tick/untick "carry dev data over" on a staged publish draft (M6e). The
   * migration itself runs at commit, only in first-install flows, only when
   * the installed domain is empty (or the user explicitly accepted an
   * overwrite after an uninstall+reinstall).
   */
  @Remote('setPublishMigrate')
  async setPublishMigrate(session: Session, draftToken: string, migrateData: boolean): Promise<{ ok: true; set: boolean }> {
    void session
    const draft = this.publishDrafts.get(draftToken)
    if (draft === undefined) return { ok: true, set: false }
    this.publishDrafts.set(draftToken, { ...draft, migrateData })
    return { ok: true, set: true }
  }

  /** Drop a staged draft without installing (declined or abandoned approval). */
  @Remote('abortPublish')
  abortPublish(session: Session, draftToken: string): { ok: boolean } {
    const draft = this.publishDrafts.get(draftToken)
    if (draft === undefined) return { ok: false }
    this.publishDrafts.delete(draftToken)
    this.presence.approveResolved(String(session.id), true)
    void rm(draft.stagingDir, { recursive: true, force: true })
    return { ok: true }
  }

  /** Remove one installed app completely: snapshots, pointer, assets, AppData. */
  /**
   * Roll the current pointer back to a history version (M6b). User-lifecycle
   * surface (same family as uninstall): code-only — data, journal, and
   * assets are untouched; the target's digest is re-verified against
   * history before the switch. Agents get visibility via `app_history`,
   * not this remote.
   */
  @Remote('rollbackInstalled')
  async rollbackInstalledRemote(session: Session, appId: string, version: string): Promise<AppStageRollbackResult> {
    const result = await rollbackInstalled(appId, version, dshHome(), { workspace: basename(session.header.cwd ?? ''), session: String(session.id) })
    return 'record' in result ? { ok: true, appId, version } : { ok: false, code: result.code, message: result.message }
  }

  /**
   * Prepare an import (M6c): resolve the source (directory or hardened git
   * clone), stage it through the same whitelist walk as publishing, probe
   * the sandbox, and resolve the watermark-tiered plan. No mutation yet —
   * the client shows the facts card and the user confirms `importCommit`.
   */
  @Remote('importPrepare')
  async importPrepare(
    session: Session, source: { kind: 'dir'; path: string } | { kind: 'git'; url: string; ref?: string },
  ): Promise<AppStageImportPrepareResult> {
    const home = dshHome()
    let srcDir: string | undefined
    let via: 'import' | 'import:git' = 'import'
    let label = ''
    if (source.kind === 'dir') {
      if (!source.path.startsWith('/') || source.path.includes('..')) {
        return { ok: false, code: 'IMPORT_PATH_INVALID', message: 'Import needs an absolute directory path.' }
      }
      const info = await stat(source.path).catch(() => undefined)
      if (info === undefined || !info.isDirectory()) {
        return { ok: false, code: 'IMPORT_PATH_INVALID', message: `"${source.path}" is not a directory.` }
      }
      srcDir = source.path
      label = basename(source.path)
    } else {
      via = 'import:git'
      const cloned = await hardenedClone(source.url, source.ref, '')
      if (!cloned.ok) return { ok: false, code: cloned.code, message: cloned.message }
      srcDir = cloned.dir
      label = new URL(source.url).hostname
    }
    // Manifest first (appId comes from the package, not the caller).
    let manifest: AppManifest
    try {
      const bytes = await readFile(join(srcDir, 'app.json'))
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { id?: unknown }
      if (typeof parsed.id !== 'string') throw new Error('app.json has no "id"')
      const validated = validateManifestBytes(parsed.id, bytes)
      if (!validated.ok) throw new Error(validated.reason.detail)
      manifest = validated.manifest
    } catch (error) {
      if (source.kind === 'git') await rm(srcDir, { recursive: true, force: true })
      return { ok: false, code: 'MANIFEST_INVALID', message: `The package's app.json is not valid: ${error instanceof Error ? error.message : String(error)}` }
    }
    const stagingDir = join(storeRoot(home), 'apps', 'staging', `import-${manifest.id}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`)
    const staged = await stageSnapshot(srcDir, stagingDir)
    if (source.kind === 'git') await rm(srcDir, { recursive: true, force: true })
    if ('code' in staged) {
      await rm(stagingDir, { recursive: true, force: true })
      return { ok: false, code: 'PACKAGE_TOO_LARGE', message: `Snapshot is ${staged.bytes} bytes; the cap is ${PACKAGE_MAX_BYTES}.` }
    }
    const entryURL = `http://${this.ctx.webServer.host}:${this.ctx.webServer.port}${this.statics.urlForDev(stagingDir, manifest.entry)}`
    const probe = await probeStaging({ entryURL, entryMIME: 'text/html', appId: manifest.id, version: manifest.version, declaredActions: manifest.actions.map(action => action.name), home })
    if (!probe.ok) {
      await rm(stagingDir, { recursive: true, force: true })
      return { ok: false, code: 'PROBE_FAILED', message: probe.detail ?? 'staging probe failed' }
    }
    const report = await buildReport(stagingDir, manifest, probe)
    const pointer = await readInstallPointer(manifest.id, home)
    const watermark = await readWatermark(manifest.id, home)
    const plan = resolveImportPlan(manifest.version, report.digest, pointer === undefined ? undefined : { version: pointer.version, digest: pointer.digest }, watermark)
    const fingerprint = via === 'import' ? `import:dir:${label}` : `import:git:${label}`
    const draftToken = randomUUID()
    this.importDrafts.set(draftToken, { appId: manifest.id, stagingDir, manifest, digest: report.digest, plan, via, label, fingerprint, sourceSession: String(session.id) })
    return {
      ok: true, draftToken, plan,
      appId: manifest.id, name: manifest.name, version: manifest.version, via, label,
      ...(pointer === undefined ? {} : { installedVersion: pointer.version }),
      report,
    }
  }

  /** Commit a confirmed import draft: install under the same chain as publish. */
  @Remote('importCommit')
  async importCommit(session: Session, draftToken: string): Promise<AppStageImportCommitResult> {
    void session
    const draft = this.importDrafts.get(draftToken)
    if (draft === undefined) return { ok: false, code: 'SOURCE_MISSING', message: 'No staged import for this token (it may have been consumed or the host restarted).' }
    this.importDrafts.delete(draftToken)
    const home = dshHome()
    const still = await readStagedManifest(draft.stagingDir, draft.appId)
    if (still === undefined || still.version !== draft.manifest.version) {
      await rm(draft.stagingDir, { recursive: true, force: true })
      return { ok: false, code: 'SOURCE_MISSING', message: 'The staged import changed during approval; re-import the package.' }
    }
    try {
      await withInstallLock(draft.appId, async () => {
        await commitSnapshot(draft.stagingDir, draft.appId, draft.manifest.version, home)
        await writeInstallPointer(draft.appId, {
          version: draft.manifest.version, digest: draft.digest, installedAt: new Date().toISOString(),
          sourceWorkspace: draft.label, sourceFingerprint: draft.fingerprint,
          sourceSession: draft.sourceSession, publishedVia: draft.via,
        }, home)
      })
    } catch (error) {
      return { ok: false, code: 'STORE_WRITE_FAILED', message: `install store write failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { ok: true, appId: draft.appId, version: draft.manifest.version, plan: draft.plan }
  }

  /** Drop a staged import without installing (cancelled or abandoned facts card). */
  @Remote('importAbort')
  async importAbort(session: Session, draftToken: string): Promise<AppStageImportAbortResult> {
    void session
    const draft = this.importDrafts.get(draftToken)
    if (draft === undefined) return { ok: true, dropped: false }
    this.importDrafts.delete(draftToken)
    await rm(draft.stagingDir, { recursive: true, force: true })
    return { ok: true, dropped: true }
  }

  @Remote('uninstall')
  async uninstall(session: Session, appId: string): Promise<AppStageUninstallResult> {
    void session
    const result = await uninstallApp(appId, dshHome())
    if ('removed' in result) {
      await removeAssets(dshHome(), appId)
      return { ok: true, appId, removed: true }
    }
    return { ok: false, code: result.code, message: result.message }
  }

  // -------------------------------------------------------------------------
  // M4 — the operation face: invoke routing through the GUI's Stage router.

  /** Resolve the installed entry an operation-face call addresses (bare id). */
  private async resolveInstalled(appId: string): Promise<{ ok: true; appId: string; version: string; manifest: AppManifest } | { ok: false; code: 'APP_NOT_INSTALLED' | 'RUNTIME_BROKEN'; message: string }> {
    const installed = await listInstalled(dshHome())
    const match = installed.find(item => item.appId === appId)
    if (match === undefined) {
      return { ok: false, code: 'APP_NOT_INSTALLED', message: `No installed app "${appId}"; the operation face addresses only installed copies (app_publish is the path onto the desktop).` }
    }
    if (match.status !== 'ready' || match.manifest === undefined || match.pointer === undefined) {
      return { ok: false, code: 'RUNTIME_BROKEN', message: `Installed app "${appId}" is not readable; app_list diagnoses the entry.` }
    }
    return { ok: true, appId, version: match.pointer.version, manifest: match.manifest }
  }

  /** Installed manifest name for presence copy (appId fallback). */
  private async installedName(appId: string): Promise<string | undefined> {
    const installed = await listInstalled(dshHome())
    return installed.find(item => item.appId === appId)?.manifest?.name
  }

  /**
   * `app_invoke` (B3): route one declared, param-checked action into the
   * Stage container the GUI router owns. The journal rev before dispatch
   * feeds the persistedKeys diff and the INVOKE_TIMEOUT actionApplied hint.
   */
  @Remote('invoke')
  async invoke(session: Session, appId: string, action: string, params: AppJsonValue): Promise<AppStageInvokeResult> {
    void session
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return resolved
    const decl = resolved.manifest.actions.find(item => item.name === action)
    if (decl === undefined) {
      return { ok: false, code: 'ACTION_NOT_DECLARED', message: `App "${appId}" declares no action "${action}"; app_manifest lists the installed contract.` }
    }
    const checked = validateInvokeParams(params, decl.params)
    if (!checked.ok) return { ok: false, code: 'PARAMS_MISMATCH', message: checked.message }
    const revBefore = await this.installedRev(appId)
    const startedAt = Date.now()
    const sessionId = String(session.id)
    this.presence.commandStarted(sessionId, { kind: 'invoke', appId, appName: resolved.manifest.name, version: resolved.version, action, origin: 'installed', paramsSummary: summarizeParams(typeof params === 'object' && params !== null && !Array.isArray(params) ? params as Readonly<Record<string, unknown>> : {}) })
    const settlement = await this.router.push(
      { kind: 'invoke', appId, version: resolved.version, name: resolved.manifest.name, action, params },
      INVOKE_TIMEOUT_MS,
    )
    const applied = (await this.installedRev(appId)) !== revBefore
    if (settlement.kind === 'reported') {
      const failure = settlement.outcome.error
      if (failure !== undefined) {
        this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'invoke', appId, appName: resolved.manifest.name, version: resolved.version, action, outcome: 'error', durationMs: Date.now() - startedAt, origin: 'installed' })
        if (failure.code === 'ACTION_NOT_REGISTERED') {
          return { ok: false, code: 'ACTION_NOT_REGISTERED', message: `the app never registered a handler for "${action}" — an app defect; check app_manifest and whether a newer version declares it.` }
        }
        if (failure.code === 'CONTAINER_UNAVAILABLE') {
          return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: `the Stage container could not present "${appId}": ${failure.message}` }
        }
        return { ok: false, code: 'HANDLER_FAILED', message: `the app's handler failed: ${failure.message} (untrusted app text)`, ...(applied ? { actionApplied: true } : {}) }
      }
      const changes = await appDataChanges('installed', appId, revBefore, undefined)
      const persistedKeys = [...new Set(changes.map(change => change.path))]
      this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'invoke', appId, appName: resolved.manifest.name, version: resolved.version, action, outcome: 'ok', durationMs: Date.now() - startedAt, keys: persistedKeys, origin: 'installed' })
      return {
        ok: true,
        appId,
        version: resolved.version,
        action,
        ...(settlement.outcome.result !== undefined ? { result: settlement.outcome.result } : {}),
        persistedKeys,
      }
    }
    if (settlement.kind === 'timeout') {
      this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'invoke', appId, appName: resolved.manifest.name, version: resolved.version, action, outcome: 'timeout', durationMs: Date.now() - startedAt, origin: 'installed' })
      return { ok: false, code: 'INVOKE_TIMEOUT', message: `the router did not complete within ${INVOKE_TIMEOUT_MS} ms; the command may already have run — verify with app_data_read before any retry (E1.1).`, ...(applied ? { actionApplied: true } : {}) }
    }
    this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'invoke', appId, appName: resolved.manifest.name, version: resolved.version, action, outcome: 'error', durationMs: Date.now() - startedAt, origin: 'installed' })
    return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: 'no Stage router is connected; the app needs a Stage container to run (open the desktop once, or app_open from a GUI-connected session).' }
  }

  /** `app_open` (B4): presentation intent — ensure the container, maybe focus. */
  @Remote('open')
  async open(session: Session, appId: string, focus: boolean): Promise<AppStageOpenResult> {
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return resolved
    const startedAt = Date.now()
    const sessionId = String(session.id)
    this.presence.commandStarted(sessionId, { kind: 'open', appId, appName: resolved.manifest.name, version: resolved.version, origin: 'installed' })
    const settlement = await this.router.push({ kind: 'open', appId, version: resolved.version, name: resolved.manifest.name, focus }, OPEN_TIMEOUT_MS)
    if (settlement.kind === 'reported') {
      if (settlement.outcome.error !== undefined) {
        this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'open', appId, appName: resolved.manifest.name, version: resolved.version, outcome: 'error', durationMs: Date.now() - startedAt, origin: 'installed' })
        return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: `the Stage router could not present the app: ${settlement.outcome.error.message}` }
      }
      this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'open', appId, appName: resolved.manifest.name, version: resolved.version, outcome: 'ok', durationMs: Date.now() - startedAt, origin: 'installed' })
      return { ok: true, appId, version: resolved.version, opened: settlement.outcome.opened ?? true, focused: settlement.outcome.focused ?? focus }
    }
    if (settlement.kind === 'timeout') {
      return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: `the Stage router did not acknowledge within ${OPEN_TIMEOUT_MS} ms (container cold-start budget).` }
    }
    return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: 'no Stage router is connected; the app needs a Stage container to run.' }
  }

  /**
   * The GUI router's long-poll face: queued requests after a cursor. The
   * `routerId` names the polling surface; delivery is single-consumer, so
   * two connected surfaces never both execute one request.
   */
  @Remote('waitRouterRequests')
  async waitRouterRequests(session: Session, afterCursor: number, routerId: string): Promise<AppStageWaitRequestsResult> {
    void session
    const reply = await this.router.waitRequests(afterCursor, routerId)
    return { ok: true, requests: reply.requests, cursor: reply.cursor }
  }

  /** The GUI router's completion report for one dispatched request. */
  @Remote('routerResult')
  routerResult(session: Session, requestId: string, outcome: AppRouterOutcome): AppStageRouterResultAck {
    void session
    const known = this.router.reportResult(requestId, outcome)
    if (!known) return { ok: false, code: 'UNKNOWN_REQUEST', message: `no pending router request "${requestId}" (already settled or timed out).` }
    return { ok: true, requestId }
  }

  // -------------------------------------------------------------------------
  // M5 — presence (Px-β): the authoritative lease face.

  /**
   * `app_takeover`: an explicit macro lease lighting the full particle
   * state. AI-self by default; user delegation (15 min budget) arrives with
   * the M5c shell controls. Renewal requires new commands — silence never
   * extends a lease.
   */
  async takeover(session: Session, appId: string, delegated: boolean): Promise<{ ok: true; lease: import('./presence.ts').PresenceLeaseSnapshot; budgetMs: number } | { ok: false; code: 'APP_NOT_INSTALLED' | 'RUNTIME_BROKEN' | 'CONTAINER_UNAVAILABLE'; message: string }> {
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return resolved
    if (!this.router.routerConnected) {
      return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: 'no Stage container is connected; a takeover lights the particle frame the user sees, so it needs a GUI surface (open the desktop once, or app_open from a GUI-connected session).' }
    }
    const lease = this.presence.takeover(String(session.id), { appId, name: resolved.manifest.name, version: resolved.version }, delegated)
    return { ok: true, lease, budgetMs: delegated ? PRESENCE_MACRO_DELEGATED_BUDGET_MS : PRESENCE_MACRO_AI_BUDGET_MS }
  }

  /** The shell's projection feed: live leases for this session. */
  @Remote('presenceSnapshot')
  presenceSnapshot(session: Session): AppStagePresenceSnapshotResult {
    return { ok: true, leases: this.presence.snapshot(String(session.id)) }
  }

  /** The activity view's feed: installed-origin rows after a cursor. */
  @Remote('presenceTimeline')
  presenceTimeline(session: Session, sinceSeq: number): AppStagePresenceTimelineResult {
    void session
    const feed = this.presence.timelineSince(sinceSeq)
    return { ok: true, rows: feed.rows, latest: feed.latest }
  }

  /**
   * The global timeline watermark: `{ seen, latest }` in one read so the
   * shell computes unread (blue dot) without a second round trip. The
   * watermark outlives host restarts (`activity-seen.json`).
   */
  @Remote('presenceSeen')
  async presenceSeen(session: Session): Promise<{ ok: true; seen: number; latest: number }> {
    void session
    return { ok: true, seen: await readActivitySeen(dshHome()), latest: this.presence.timelineSince(0).latest }
  }

  /** Advance the watermark to the feed's current head (clears the dot). */
  @Remote('presenceMarkSeen')
  async presenceMarkSeen(session: Session, seq: number): Promise<{ ok: true; seen: number }> {
    void session
    const { latest } = this.presence.timelineSince(0)
    const next = Math.max(0, Math.min(seq, latest))
    await writeActivitySeen(next, dshHome())
    return { ok: true, seen: next }
  }

  /** A lease summary by id (the card material, fetched on release). */
  @Remote('presenceSummary')
  presenceSummary(session: Session, leaseId: string): AppStagePresenceSummaryResult {
    void session
    const summary = this.presence.summary(leaseId)
    if (summary === undefined) return { ok: false, code: 'UNKNOWN_LEASE', message: `no summary for lease "${leaseId}" (unknown or evicted).` }
    return { ok: true, summary }
  }

  /** User-side lease controls: interrupt / resume / handback (X1). */
  @Remote('presenceControl')
  presenceControl(session: Session, op: 'interrupt' | 'resume' | 'handback'): AppStagePresenceControlResult {
    const sessionId = String(session.id)
    if (op === 'interrupt') return { ok: true, applied: this.presence.interrupt(sessionId) }
    if (op === 'resume') return { ok: true, applied: this.presence.resume(sessionId) }
    if (op === 'handback') return { ok: true, applied: this.presence.handback(sessionId) }
    return { ok: false, code: 'OP_INVALID', message: `unknown presence op "${op}"` }
  }

  /**
   * `app_asset_write` (B9): copy one workspace file into the installed
   * app's runtime asset directory. Addresses installed copies only — the
   * dev domain has no asset channel (fixtures in source serve self-tests).
   */
  @Remote('assetWrite')
  async assetWrite(session: Session, appId: string, name: string, sourcePath: string): Promise<AppStageAssetWriteResult> {
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return { ok: false, code: 'APP_NOT_INSTALLED', message: resolved.message }
    const cwd = session.header.cwd
    if (cwd === undefined) return { ok: false, code: 'SOURCE_PATH_INVALID', message: 'This session has no workspace to read the source from.' }
    const startedAt = Date.now()
    const sessionId = String(session.id)
    this.presence.commandStarted(sessionId, { kind: 'asset.write', appId, appName: resolved.manifest.name, version: resolved.version, origin: 'installed' })
    const written = await writeAsset(dshHome(), appId, name, sourcePath, cwd)
    this.presence.commandSettled(sessionId, { ts: startedAt, kind: 'asset.write', appId, appName: resolved.manifest.name, version: resolved.version, outcome: written.ok ? 'ok' : 'error', durationMs: Date.now() - startedAt, origin: 'installed' })
    if (!written.ok) return { ok: false, code: written.code, message: written.message }
    return { ...written.result }
  }

  /** `app_asset_list` (B10): the app's assets with quota usage. */
  @Remote('assetList')
  async assetList(session: Session, appId: string): Promise<AppStageAssetListResult> {
    void session
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return { ok: false, code: 'APP_NOT_INSTALLED', message: resolved.message }
    const listed = await listAssets(dshHome(), appId)
    return { ok: true, appId, ...listed }
  }

  /**
   * Delete one named runtime asset (M6e). Same name fence as write; the
   * dangling-reference tradeoff is stated in the tool description and the
   * client's orphan hint, not silently repaired.
   */
  @Remote('assetDelete')
  async assetDelete(session: Session, appId: string, name: string): Promise<AppStageAssetDeleteResult> {
    void session
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return { ok: false, code: 'APP_NOT_INSTALLED', message: resolved.message }
    const result = await deleteAsset(dshHome(), appId, name)
    return result.ok ? { ok: true, appId, name } : { ok: false, code: result.code, message: result.message }
  }

  /** Current journal rev of an installed app's AppData document (0 when absent). */
  private async installedRev(appId: string): Promise<number> {
    try {
      const { rev } = await appDataGet('installed', appId, undefined, undefined)
      return rev
    } catch {
      return 0
    }
  }
}


export default AppStageService
export type { AppDevEntry, AppInstalledEntry }
