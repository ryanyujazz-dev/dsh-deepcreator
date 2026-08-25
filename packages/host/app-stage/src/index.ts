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
import type { AppDataChange, AppDevEntry, AppInstalledEntry, AppJsonValue, AppManifest, AppPublishPlan, AppStageDataChangesResult, AppStageDataGetResult, AppStageDataSetResult, AppStageEnsureResult, AppStageListResult, AppStagePublishCommitResult, AppStagePublishPrepareResult, AppStageUninstallResult } from './types.ts'
import { AppStageStaticServer } from './serve.ts'
import { listInstalled, gateDevEntry, scanDevRoot } from './registry.ts'
import { dshHome, readInstallPointer, readOpenedVersions, recordOpenedVersion, storeRoot } from './store.ts'
import { ensurePreset } from './preset.ts'
import { AppStageWatcherSet } from './watcher.ts'
import { appDataChanges, appDataGet, appDataSet } from './appdata.ts'
import { buildReport, commitSnapshot, gateForPublish, PACKAGE_MAX_BYTES, publishFingerprint, readStagedManifest, resolvePlan, stageSnapshot, uninstallApp, writeInstallPointer } from './publish.ts'
import { probeStaging } from './probe.ts'

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
  }

  /** Materialize (or verify + heal) the app-stage agent preset. */
  async materializePreset(home: string = dshHome()): Promise<'materialized' | 'verified' | 'healed'> {
    const presetsRoot = `${home}/.agent-presets`
    return ensurePreset(presetsRoot, message => this.ctx.logger.warn(message))
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
      return { ok: true, value: value as AppJsonValue, rev }
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
}

export default AppStageService
export type { AppDevEntry, AppInstalledEntry }
