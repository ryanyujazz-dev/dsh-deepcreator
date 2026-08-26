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
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-workspace'
import type { AppDataChange, AppDevEntry, AppInstalledEntry, AppJsonValue, AppManifest, AppPublishPlan, AppRouterOutcome, AppStageDataChangesResult, AppStageDataGetResult, AppStageDataSetResult, AppStageEnsureResult, AppStageInvokeResult, AppStageListResult, AppStageOpenResult, AppStagePublishCommitResult, AppStagePublishPrepareResult, AppStageRouterResultAck, AppStageUninstallResult, AppStageWaitRequestsResult } from './types.ts'
import { AppStageStaticServer } from './serve.ts'
import { listInstalled, gateDevEntry, scanDevRoot } from './registry.ts'
import { dshHome, readInstallPointer, readOpenedVersions, recordOpenedVersion, storeRoot } from './store.ts'
import { ensurePreset } from './preset.ts'
import { AppStageWatcherSet } from './watcher.ts'
import { appDataChanges, appDataGet, appDataSet } from './appdata.ts'
import { buildReport, commitSnapshot, gateForPublish, PACKAGE_MAX_BYTES, publishFingerprint, readStagedManifest, resolvePlan, stageSnapshot, uninstallApp, writeInstallPointer } from './publish.ts'
import { probeStaging } from './probe.ts'
import { AppRouterHub, INVOKE_TIMEOUT_MS, OPEN_TIMEOUT_MS } from './control.ts'
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
export { validateInvokeParams } from './params.ts'
export { readOpenedVersions, recordOpenedVersion } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { appStage: AppStageService }
}

export const inject = ['webServer', 'workspaceRegistry', 'sessions']

/** One staged publish draft held between `preparePublish` and the commit. */
interface PublishDraft {
  readonly appId: string
  readonly stagingDir: string
  readonly manifest: AppManifest
  readonly fingerprint: string
  readonly plan: AppPublishPlan
  readonly sourceWorkspace: string
  readonly sourceSession: string
  readonly digest: string
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
  /** The M4 operation face's routing hub (long-polled by the GUI router). */
  private readonly router = new AppRouterHub()

  constructor(ctx: Context) {
    super(ctx, 'appStage')
    this.statics = new AppStageStaticServer(ctx.webServer)
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
      return () => {
        created()
        disposed()
        this.watchers.dispose()
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

  /** Bridge `data.set`: one validated key-path write, journaled. */
  @Remote('dataSet')
  async dataSet(session: Session, ref: string, path: string, value: AppJsonValue, causeId: string): Promise<AppStageDataSetResult> {
    const resolved = await this.resolveDataRef(session, ref)
    if (!resolved.ok) return resolved
    try {
      const { rev } = await appDataSet(resolved.scope, resolved.appId, path, value, causeId, resolved.cwd, resolved.schemaVersion)
      return { ok: true, rev }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const code = message.startsWith('PATH_INVALID') ? 'PATH_INVALID' : message.startsWith('VALUE_TOO_LARGE') ? 'VALUE_TOO_LARGE' : 'DOC_TOO_LARGE'
      return { ok: false, code, message }
    }
  }

  /** Bridge `data.subscribe` delivery face: journal entries after a rev. */
  @Remote('dataChanges')
  async dataChanges(session: Session, ref: string, sinceRev: number): Promise<AppStageDataChangesResult> {
    const resolved = await this.resolveDataRef(session, ref)
    if (!resolved.ok) return resolved
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
    const plan = resolvePlan(manifest.version, pointer === undefined ? undefined : { version: pointer.version, sourceFingerprint: pointer.sourceFingerprint }, fingerprint)
    if (typeof plan !== 'string') return { ok: false, code: plan.code, message: plan.code === 'VERSION_NOT_BUMPED' ? `Version ${manifest.version} is already installed; bump the version to publish an update.` : `Version ${manifest.version} is lower than the installed ${pointer!.version}; downgrades are rejected.` }
    const stagingDir = join(storeRoot(home), 'apps', 'staging', `${appId}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`)
    const staged = await stageSnapshot(gated.dir, stagingDir)
    if ('code' in staged) return { ok: false, code: 'PACKAGE_TOO_LARGE', message: `Snapshot is ${staged.bytes} bytes; the cap is ${PACKAGE_MAX_BYTES}.` }
    const entryURL = `http://${this.ctx.webServer.host}:${this.ctx.webServer.port}${this.statics.urlForDev(stagingDir, manifest.entry)}`
    const probe = await probeStaging({ entryURL, entryMIME: 'text/html', appId, version: manifest.version, home })
    if (!probe.ok) {
      await rm(stagingDir, { recursive: true, force: true })
      return { ok: false, code: 'PROBE_FAILED', message: probe.detail ?? 'staging probe failed' }
    }
    const report = await buildReport(stagingDir, manifest, probe)
    const draftToken = randomUUID()
    this.publishDrafts.set(draftToken, { appId, stagingDir, manifest, fingerprint, plan, sourceWorkspace: basename(cwd), sourceSession: String(session.id), digest: report.digest })
    return {
      ok: true, draftToken, plan,
      ...(pointer === undefined ? {} : { previous: { version: pointer.version, sourceWorkspace: pointer.sourceWorkspace } }),
      report,
    }
  }

  /** Publish commit: move the staged snapshot into the store + pointer write. */
  @Remote('commitPublish')
  async commitPublish(session: Session, draftToken: string): Promise<AppStagePublishCommitResult> {
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
    try {
      await commitSnapshot(draft.stagingDir, draft.appId, draft.manifest.version, home)
      await writeInstallPointer(draft.appId, {
        version: draft.manifest.version, digest: draft.digest, installedAt: new Date().toISOString(),
        sourceWorkspace: draft.sourceWorkspace, sourceFingerprint: draft.fingerprint,
        sourceSession: draft.sourceSession, publishedVia: 'app_publish',
      }, home)
    } catch (error) {
      return { ok: false, code: 'STORE_WRITE_FAILED', message: `install store write failed: ${error instanceof Error ? error.message : String(error)}` }
    }
    return { ok: true, appId: draft.appId, version: draft.manifest.version, plan: draft.plan }
  }

  /** Drop a staged draft without installing (declined or abandoned approval). */
  @Remote('abortPublish')
  abortPublish(session: Session, draftToken: string): { ok: boolean } {
    void session
    const draft = this.publishDrafts.get(draftToken)
    if (draft === undefined) return { ok: false }
    this.publishDrafts.delete(draftToken)
    void rm(draft.stagingDir, { recursive: true, force: true })
    return { ok: true }
  }

  /** Remove one installed app completely: snapshots, pointer, assets, AppData. */
  @Remote('uninstall')
  async uninstall(session: Session, appId: string): Promise<AppStageUninstallResult> {
    void session
    const result = await uninstallApp(appId, dshHome())
    if ('removed' in result) return { ok: true, appId, removed: true }
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
    const settlement = await this.router.push(
      { kind: 'invoke', appId, version: resolved.version, action, params },
      INVOKE_TIMEOUT_MS,
    )
    const applied = (await this.installedRev(appId)) !== revBefore
    if (settlement.kind === 'reported') {
      const failure = settlement.outcome.error
      if (failure !== undefined) {
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
      return { ok: false, code: 'INVOKE_TIMEOUT', message: `the router did not complete within ${INVOKE_TIMEOUT_MS} ms; the command may already have run — verify with app_data_read before any retry (E1.1).`, ...(applied ? { actionApplied: true } : {}) }
    }
    return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: 'no Stage router is connected; the app needs a Stage container to run (open the desktop once, or app_open from a GUI-connected session).' }
  }

  /** `app_open` (B4): presentation intent — ensure the container, maybe focus. */
  @Remote('open')
  async open(session: Session, appId: string, focus: boolean): Promise<AppStageOpenResult> {
    void session
    const resolved = await this.resolveInstalled(appId)
    if (!resolved.ok) return resolved
    const settlement = await this.router.push({ kind: 'open', appId, version: resolved.version, focus }, OPEN_TIMEOUT_MS)
    if (settlement.kind === 'reported') {
      if (settlement.outcome.error !== undefined) {
        return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: `the Stage router could not present the app: ${settlement.outcome.error.message}` }
      }
      return { ok: true, appId, version: resolved.version, opened: settlement.outcome.opened ?? true, focused: settlement.outcome.focused ?? focus }
    }
    if (settlement.kind === 'timeout') {
      return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: `the Stage router did not acknowledge within ${OPEN_TIMEOUT_MS} ms (container cold-start budget).` }
    }
    return { ok: false, code: 'CONTAINER_UNAVAILABLE', message: 'no Stage router is connected; the app needs a Stage container to run.' }
  }

  /** The GUI router's long-poll face: queued requests after a cursor. */
  @Remote('waitRouterRequests')
  async waitRouterRequests(session: Session, afterCursor: number): Promise<AppStageWaitRequestsResult> {
    void session
    const reply = await this.router.waitRequests(afterCursor)
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
