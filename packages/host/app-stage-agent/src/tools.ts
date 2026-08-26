/**
 * The app_* tool face (first batch): `app_list` (know/diagnose) and
 * `app_manifest` (know). Both address the calling session's own workspace for
 * the dev scope and the global install store for installed apps, read through
 * the resident registry's pure functions; failures return the unified
 * envelope `{error:{code,message,context}}` rather than throwing, so the
 * model always receives an actionable JSON fact.
 *
 * Every tool here registers ONLY inside app-stage preset sessions (tool
 * availability is permission — this package is a preset row, never a bundle
 * row).
 * @module @ryanyujazz/dsh-app-stage-agent/tools
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type JsonValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { AppStageService } from '@ryanyujazz/dsh-app-stage'
import { ASSET_NAME_PATTERN, dshHome, installedVersionDir, listInstalled, scanDevRoot } from '@ryanyujazz/dsh-app-stage'

/** The unified failure envelope (B0): machine code, model-facing message, context keys. */
export interface ToolErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string; readonly context: Record<string, string> }
}

/** Build the B0 failure envelope. */
export function toolError(code: string, message: string, context: Record<string, string> = {}): ToolErrorEnvelope {
  return { error: { code, message, context } }
}

const outputSchema = { type: 'json' } as const
const render = (_args: unknown, value: unknown): { type: 'text'; text: string }[] => [{ type: 'text' as const, text: JSON.stringify(value) }]

/**
 * Models routinely deliver a `json`-typed parameter as a JSON-encoded
 * string (double serialization). Unwrap once before use; a parse failure
 * falls through so validation rejects with a clear message.
 */
function coerceJsonArg(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

/** JSON-safe projection of one journal/tool value. */
function json(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

function owner(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('app_* tools require an owning agent session.')
  return exec.agent
}

/** Wire entry shapes of the `app_list` result (B1). */
export interface AppListInstalledWire {
  readonly appId: string
  readonly name: string
  readonly version: string
  readonly platform: string
  readonly status: 'ready' | 'broken'
  readonly originURL?: string
  readonly actionsSummary: readonly string[]
  readonly sourceWorkspace: string
  readonly updatedAt: string
}

export interface AppListDevWire {
  readonly appId: string
  readonly version?: string
  readonly status: 'ready' | 'incomplete' | 'rejected' | 'broken'
  readonly reason?: { code: string; detail: string; fix: string }
  readonly originURL?: string
  readonly conflictsWithInstalled: boolean
}

/** The environment the tool face reads (resident service + home override for tests). */
export interface AppToolEnvironment {
  readonly appStage: Pick<AppStageService, 'devOriginURL' | 'installedOriginURL'>
  /** DSH home override (tests); default is the real resolved home. */
  readonly home?: string
}

/**
/** The environment the M4 operation tools read (service faces + home override). */
export interface AppOperationEnvironment {
  readonly appStage: Pick<AppStageService, 'devOriginURL' | 'installedOriginURL' | 'invoke' | 'open' | 'dataGet' | 'dataSet' | 'dataProbe' | 'assetWrite' | 'assetList'>
  /** DSH home override (tests); default is the real resolved home. */
  readonly home?: string
}

/**
 * `app_list` — discovery + diagnosis from both sources: the global desktop
 * (installed) and this session's workspace (dev, including gate-rejected
 * entries with machine reasons). `originURL` on ready dev entries is the
 * self-test entry point for the agent's own browser instance.
 */
export function createAppListTool(env: AppToolEnvironment): ToolDefinition {
  return defineTool({
    name: 'app_list',
    description: 'List and diagnose apps from both discovery sources. Use at the start of any app work: check a dev app\'s gate status before publishing, discover installed apps and their action summaries before driving them, and get originURL to self-test a dev app in your own browser instance. scope:\'installed\' = the global desktop; \'dev\' = this session\'s workspace, including gate-rejected entries with machine reasons; \'all\' (default) = both.',
    parameters: {
      scope: { type: 'string', enum: ['installed', 'dev', 'all'], description: 'Which discovery source to list.', default: 'all' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const scope = (args as { scope?: string }).scope ?? 'all'
      const home = env.home ?? dshHome()
      const installedWanted = scope === 'installed' || scope === 'all'
      const devWanted = scope === 'dev' || scope === 'all'
      const installed = installedWanted ? await listInstalled(home) : []
      const installedIds = new Set(installed.map(entry => entry.appId))
      const cwd = owner(exec).session.header.cwd

      const installedWire: AppListInstalledWire[] = installed.map(entry => {
        const manifest = entry.manifest
        const ready = entry.status === 'ready' && manifest !== undefined && entry.pointer !== undefined
        return {
          appId: entry.appId,
          name: manifest?.name ?? entry.appId,
          version: entry.pointer?.version ?? '',
          platform: manifest?.platform ?? 'app-stage-v1',
          status: ready ? 'ready' : 'broken',
          ...(ready && manifest !== undefined && entry.pointer !== undefined
            ? { originURL: env.appStage.installedOriginURL(entry.appId, entry.pointer.version, manifest.entry) }
            : {}),
          actionsSummary: manifest ? manifest.actions.map(action => action.name) : [],
          sourceWorkspace: entry.pointer?.sourceWorkspace ?? '',
          updatedAt: entry.pointer?.installedAt ?? '',
        }
      })

      const devWire: AppListDevWire[] = []
      if (devWanted) {
        if (cwd === undefined) {
          return json({ error: { code: 'NO_WORKSPACE', message: 'This session has no workspace binding; the dev scope lists nothing.', context: {} } })
        }
        const dev = await scanDevRoot(cwd, installedIds)
        for (const entry of dev) {
          const ready = entry.status === 'ready' && entry.manifest !== undefined
          devWire.push({
            appId: entry.appId,
            ...(entry.manifest !== undefined ? { version: entry.manifest.version } : {}),
            status: entry.status,
            ...(entry.reason !== undefined ? { reason: { code: entry.reason.code, detail: entry.reason.detail, fix: entry.reason.fix } } : {}),
            ...(ready && entry.manifest !== undefined
              ? { originURL: env.appStage.devOriginURL(join(cwd, '.deepcreator/apps', entry.appId), entry.manifest.entry) }
              : {}),
            conflictsWithInstalled: entry.conflictsWithInstalled,
          })
        }
      }
      return json(installedWanted && devWanted ? { installed: installedWire, dev: devWire } : installedWanted ? { installed: installedWire } : { dev: devWire })
    },
  })
}

/**
 * `app_manifest` — the full published manifest of one installed app plus its
 * agent guide inline (progressive disclosure: the list carries action names,
 * this carries schemas + usage knowledge). Reads the installed snapshot, not
 * workspace source.
 */
export function createAppManifestTool(env: AppToolEnvironment): ToolDefinition {
  return defineTool({
    name: 'app_manifest',
    description: 'Read the full published manifest of an installed app — every action\'s description, params, and persist declaration exactly as installed, plus the app\'s agent guide inline when it ships one. Use before the first invoke of an unfamiliar app, whenever app_list\'s action-name summary is not enough to fill params, and when behavior drift suggests the app updated. Reads the installed snapshot, not workspace source (which may be unreachable or diverged).',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app\'s id (bare id addresses the installed copy): kebab-case segments of [a-z0-9], ≤64 chars.' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      void exec
      const appId = (args as { appId: string }).appId
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', `appId "${appId}" is not a legal app id (kebab-case segments of [a-z0-9], ≤64 chars).`, { appId }))
      }
      const home = env.home ?? dshHome()
      const installed = await listInstalled(home)
      const match = installed.find(entry => entry.appId === appId)
      if (match === undefined) {
        return json(toolError('APP_NOT_INSTALLED', `No installed app "${appId}". Bare appId addresses the installed copy; check app_list scope:'installed'.`, { appId }))
      }
      if (match.status !== 'ready' || match.manifest === undefined || match.pointer === undefined) {
        return json(toolError('RUNTIME_BROKEN', `Installed app "${appId}" failed its integrity check (${match.reason?.code ?? 'runtime.broken'}): ${match.reason?.detail ?? 'snapshot digest mismatch'}.`, { appId }))
      }
      const versionDir = installedVersionDir(appId, match.pointer.version, home)
      let manifestRaw: unknown
      try {
        manifestRaw = JSON.parse(await readFile(join(versionDir, 'app.json'), 'utf8')) as unknown
      } catch {
        manifestRaw = match.manifest
      }
      let agentGuide: string | undefined
      if (match.manifest.agentGuide !== undefined) {
        const guide = await readFile(join(versionDir, match.manifest.agentGuide), 'utf8').catch(() => undefined)
        if (guide !== undefined) agentGuide = guide.length > 32_768 ? `${guide.slice(0, 32_768)}\n[TRUNCATED at 32 KiB]` : guide
      }
      return json({
        appId,
        version: match.pointer.version,
        platform: match.manifest.platform,
        manifest: manifestRaw,
        ...(agentGuide !== undefined ? { agentGuide } : {}),
      })
    },
  })
}

/** The publish tool's view of the resident service (Typert remote methods). */
export interface AppPublishServiceFace {
  preparePublish(session: import('@deepseek-ai/dsh-session').Session, appId: string): Promise<import('@ryanyujazz/dsh-app-stage/types').AppStagePublishPrepareResult>
  commitPublish(session: import('@deepseek-ai/dsh-session').Session, draftToken: string): Promise<import('@ryanyujazz/dsh-app-stage/types').AppStagePublishCommitResult>
  abortPublish(session: import('@deepseek-ai/dsh-session').Session, draftToken: string): { ok: boolean }
}

/** The user-questions seam the approval hangs on (S1: official service). */
export interface AppPublishAskFace {
  ask(request: {
    questions: readonly {
      id: string
      question: string
      header?: string
      detail?: string
      options?: readonly { label: string; description?: string }[]
    }[]
    agent?: unknown
    signal?: AbortSignal
  }): Promise<{ answers: readonly { id: string; selected: readonly string[] }[] }>
}

/** Environment for the publish tool (resident service + ask seam + session-local state). */
export interface AppPublishEnvironment {
  readonly appStage: AppPublishServiceFace
  readonly userQuestions: AppPublishAskFace
}

/** Declines before the session is banned from publishing (v0.0.5: 2). */
export const PUBLISH_DECLINE_BAN = 2

const APPROVE = '安装'
const DECLINE = '拒绝'

/** Render the approval card's rich detail (shared facts, plain text). */
function approvalDetail(report: import('@ryanyujazz/dsh-app-stage/types').AppPublishReport, plan: string, previous: { version: string; sourceWorkspace: string } | undefined, cwdName: string): string {
  const lines = [
    `应用：${report.name}（${report.appId}）v${report.version}`,
    `来源工作区：${cwdName}`,
  ]
  if (previous !== undefined) lines.push(`原安装来自：${previous.sourceWorkspace}（v${previous.version}）`)
  lines.push(`内容：${report.fileCount} 个文件，${(report.totalBytes / 1024).toFixed(1)} KiB，digest ${report.digest.slice(0, 16)}…`)
  lines.push(`机器扫描（零外联）：${report.scan.violations.length === 0 ? '通过，无绝对 URL 与导航 API' : `发现 ${report.scan.violations.length} 处（首条：${report.scan.violations[0]!.file} ${report.scan.violations[0]!.kind}）`}`)
  lines.push(`桥订阅验证：${report.probe.ok ? `通过（订阅键 ${report.probe.subscribedKeys.join(', ')}）` : `失败：${report.probe.detail ?? '未知原因'}`}`)
  lines.push(`首屏截图：${report.probe.screenshotTaken ? '已生成' : '降级为 icon+名称'}`)
  lines.push(plan === 'first' ? '首次发布将安装到你的全局桌面。' : '此更新将替换你桌面上的现有版本。')
  lines.push('可随时移除：卸载即净（快照、资产、数据域）。')
  return lines.join('\n')
}

/**
 * `app_publish` — the publish chain (Phase 1b): snapshot + zero-external scan +
 * staging machine probe, then the approval policy — first publish and
 * cross-source updates hang on the user-questions seam (no timeout; explicit
 * cancel is USER_DECLINED; session end silently discards), same-source updates
 * install without asking. Two declines ban this session from publishing.
 */
export function createAppPublishTool(env: AppPublishEnvironment): ToolDefinition {
  let declines = 0
  return defineTool({
    name: 'app_publish',
    description: 'Publish a dev app from this workspace to the global desktop. Machine-verifies first (snapshot, zero-external scan, staging probe with bridge-subscription check), then follows the approval policy: first publish and cross-workspace updates wait for user approval (the question card hangs without timeout; two declines ban this session); same-source version updates install directly. Bump the version before republishing — same and lower versions are rejected.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The dev app id to publish: kebab-case segments of [a-z0-9], ≤64 chars. Must be status:ready in app_list scope:\'dev\'.' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const agent = owner(exec)
      const session = agent.session
      const appId = (args as { appId: string }).appId
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', `appId "${appId}" is not a legal app id (kebab-case segments of [a-z0-9], ≤64 chars).`, { appId }))
      }
      if (declines >= PUBLISH_DECLINE_BAN) {
        return json(toolError('USER_DECLINED', `This session declined ${declines} publishes; publishing is banned here. Start a new session to publish again.`, { appId, declines: String(declines) }))
      }
      const prepared = await env.appStage.preparePublish(session, appId)
      if (!prepared.ok) return json(toolError(prepared.code, prepared.message, { appId }))

      const { draftToken, plan, report } = prepared
      const cwdName = session.header.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? 'unknown workspace'
      if (plan !== 'update-same-source') {
        let approved = false
        try {
          const answer = await env.userQuestions.ask({
            questions: [{
              id: `publish:${appId}:${report.version}`,
              question: plan === 'first'
                ? `首次发布「${report.name}」v${report.version} 到你的全局桌面？`
                : `「${report.name}」的更新来自不同工作区（原安装来自 ${prepared.previous?.sourceWorkspace ?? '未知'}），安装 v${report.version}？`,
              ...(plan === 'first' ? { header: '发布审批' } : { header: '异源更新确认' }),
              detail: approvalDetail(report, plan, prepared.previous, cwdName),
              options: [
                { label: APPROVE, description: `安装 v${report.version} 到全局桌面；可随时卸载。` },
                { label: DECLINE, description: '不安装、不占 id。' },
              ],
            }],
            agent,
            ...(exec.signal === undefined ? {} : { signal: exec.signal }),
          })
          approved = answer.answers[0]?.selected.includes(APPROVE) === true
        } catch (error) {
          void env.appStage.abortPublish(session, draftToken)
          const code = String((error as { code?: unknown })?.code ?? '')
          if (code === 'ASK_CANCELLED') {
            declines += 1
            return json(toolError('USER_DECLINED', 'The user cancelled this publish approval.', { appId }))
          }
          throw error
        }
        if (!approved) {
          declines += 1
          void env.appStage.abortPublish(session, draftToken)
          return json(toolError('USER_DECLINED', `The user declined publishing "${appId}" v${report.version}.${declines >= PUBLISH_DECLINE_BAN ? ' Two declines reached: publishing is banned for this session.' : ''}`, { appId, declines: String(declines) }))
        }
      }

      const committed = await env.appStage.commitPublish(session, draftToken)
      if (!committed.ok) return json(toolError(committed.code, committed.message, { appId }))
      return json({
        appId: committed.appId,
        version: committed.version,
        plan: committed.plan,
        digest: report.digest,
        subscribedKeys: report.probe.subscribedKeys,
        scanViolations: report.scan.violations.length,
        screenshotTaken: report.probe.screenshotTaken,
        note: committed.plan === 'update-same-source' ? 'Same-source update installed without approval (blue dot marks it on the desktop).' : 'Installed; the app now appears on the global desktop.',
      })
    },
  })
}

// ---------------------------------------------------------------------------
// M4 — the operation face: invoke, open, and the installed-domain data tools.

/** Invoke-phase failure codes that trip the per-app circuit (E1). */
const CIRCUIT_CODES = new Set(['HANDLER_FAILED', 'INVOKE_TIMEOUT', 'ACTION_NOT_REGISTERED', 'CONTAINER_UNAVAILABLE'])

/** Consecutive invoke failures (per app) before the session circuit opens. */
export const INVOKE_CIRCUIT_THRESHOLD = 5

/** `app_invoke` (B3): the structured command channel — drive one declared
 * action of an installed app inside the Stage container. No automatic retry
 * (actions are non-idempotent by default); five consecutive execution-phase
 * failures on one app open the session's circuit. */
export function createAppInvokeTool(env: AppOperationEnvironment): ToolDefinition {
  const failures = new Map<string, number>()
  let calls = 0
  return defineTool({
    name: 'app_invoke',
    description: 'Drive one declared action of an installed app through the structured command channel; the user\'s view is not switched (see app_open for presentation). Use this instead of DOM automation whenever the app declares a matching action. appId addresses only the installed copy; action must exist in the installed manifest; params must match declared names and types — extras or mistyped keys are rejected before execution. The return carries {appId, version} for skill-pack drift awareness.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app id: kebab-case segments of [a-z0-9], ≤64 chars. Dev copies are not addressable here — app_publish first.' },
      action: { type: 'string', required: true, description: 'The declared action name (camelCase, ≤64 chars) exactly as app_manifest lists it.' },
      params: { type: 'json', description: 'Arguments object for the action: only keys the manifest declares, each matching its declared type (string|number|boolean|json). Omit when the action declares none.' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const session = owner(exec).session
      const { appId, action } = args as { appId: string; action: string }
      calls += 1
      if (calls > 384) {
        return json(toolError('INVOKE_LIMIT', 'This session exceeded the invoke budget (384 = the 48-per-turn cap with long-session headroom); per-app circuits already force diagnosis — finish the work or start a new session.', { appId }))
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', `appId "${appId}" is not a legal app id (kebab-case segments of [a-z0-9], ≤64 chars).`, { appId }))
      }
      if (!/^[a-z][a-zA-Z0-9]*$/.test(action) || action.length > 64) {
        return json(toolError('ACTION_INVALID', `action "${action}" is not a legal action name (camelCase, ≤64 chars).`, { appId, action }))
      }
      const circuit = failures.get(appId) ?? 0
      if (circuit >= INVOKE_CIRCUIT_THRESHOLD) {
        return json(toolError('CIRCUIT_OPEN', `App "${appId}" failed ${circuit} consecutive invokes in this session; the circuit is open. Diagnose with app_list / app_manifest before any further attempt.`, { appId, failures: String(circuit) }))
      }
      const params = coerceJsonArg((args as { params?: unknown }).params ?? {}) as import('@ryanyujazz/dsh-app-stage/types').AppJsonValue
      const result = await env.appStage.invoke(session, appId, action, params)
      if (!result.ok) {
        if (CIRCUIT_CODES.has(result.code)) failures.set(appId, circuit + 1)
        return json(toolError(result.code, result.message, {
          appId, action,
          ...(result.actionApplied === true ? { actionApplied: 'true' } : {}),
          ...(result.code === 'INVOKE_TIMEOUT' ? { fix: 'verify with app_data_read before any retry — the command may already have run' } : {}),
        }))
      }
      failures.delete(appId)
      return json({
        appId: result.appId,
        version: result.version,
        action: result.action,
        ...(result.result === undefined ? {} : { result: result.result }),
        persistedKeys: result.persistedKeys,
      })
    },
  })
}

/** `app_open` (B4): presentation intent — ensure the Stage container is open;
 * focus:true is the agent face's only user-view switch and is reserved for
 * when the user asked to see or final output is ready. */
export function createAppOpenTool(env: AppOperationEnvironment): ToolDefinition {
  let opens = 0
  return defineTool({
    name: 'app_open',
    description: 'Present an installed app to the user by ensuring its Stage container is open. Use when the user wants to see an app or you have produced results worth showing; do not use it to drive actions (use app_invoke). focus:false (default) only opens the container and lights the activity signal without changing the user\'s view; focus:true additionally switches the user into apps mode and focuses the container — reserve it for when the user asked to see or you are presenting final output.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app id: kebab-case segments of [a-z0-9], ≤64 chars.' },
      focus: { type: 'boolean', description: 'Additionally switch the user into apps mode (default false).' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const session = owner(exec).session
      const { appId } = args as { appId: string }
      const focus = (args as { focus?: boolean }).focus === true
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', `appId "${appId}" is not a legal app id (kebab-case segments of [a-z0-9], ≤64 chars).`, { appId }))
      }
      opens += 1
      if (opens > 128) {
        return json(toolError('OPEN_LIMIT', 'This session exceeded the open budget (128 = the 16-per-turn cap with long-session headroom); the container set is already as open as it can be.', { appId }))
      }
      const result = await env.appStage.open(session, appId, focus)
      if (!result.ok) return json(toolError(result.code, result.message, { appId }))
      return json({ appId: result.appId, version: result.version, opened: result.opened, focused: result.focused })
    },
  })
}

/** `app_data_read` (B5): read an installed app's AppData at key-path
 * granularity — learn structure before writing, verify a write or invoke took
 * effect (AppData is the single source of truth; DOM is a projection). */
export function createAppDataReadTool(env: AppOperationEnvironment): ToolDefinition {
  return defineTool({
    name: 'app_data_read',
    description: 'Read the AppData document of an installed app at key-path granularity. Use it to learn an app\'s data structure before writing, to verify a write or invoke took effect (AppData is the single source of truth; DOM is a projection), and to feed app output into your reasoning. Omit path for the whole document (may approach the 4 MiB cap — prefer narrow reads first). found:false distinguishes an absent path from a stored null.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app id: kebab-case segments of [a-z0-9], ≤64 chars.' },
      path: { type: 'string', description: 'Dot-separated key path (segments [A-Za-z0-9_-], ≤256 chars total). Omit for the whole document.' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const session = owner(exec).session
      const { appId } = args as { appId: string }
      const path = (args as { path?: string }).path
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', `appId "${appId}" is not a legal app id (kebab-case segments of [a-z0-9], ≤64 chars).`, { appId }))
      }
      if (path !== undefined && !/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(path)) {
        return json(toolError('PATH_INVALID', `path "${path}" is not a legal dot-separated key path.`, { appId, path }))
      }
      const result = await env.appStage.dataProbe(session, appId, path)
      if (!result.ok) {
        const code = result.code === 'NOT_FOUND' ? 'APP_NOT_INSTALLED' : result.code === 'NOT_READY' ? 'RUNTIME_BROKEN' : result.code
        return json(toolError(code, result.message, { appId }))
      }
      return json({
        appId,
        ...(path === undefined ? {} : { path }),
        found: result.found,
        ...(result.found ? { value: result.value } : {}),
        dataVersion: String(result.rev),
      })
    },
  })
}

/** `app_data_write` (B6): write one key path of an installed app's AppData;
 * the change broadcasts to every open instance immediately and is journaled.
 * One call writes one path — sequential calls preserve per-entry journal
 * semantics. */
export function createAppDataWriteTool(env: AppOperationEnvironment): ToolDefinition {
  let writes = 0
  let consecutiveFailures = 0
  return defineTool({
    name: 'app_data_write',
    description: 'Write one key path of an installed app\'s AppData document; the change broadcasts to every open instance immediately and is journaled. Use it to deliver your work output into apps — feeding apps is your job, not the user\'s. One call writes one path (multi-key updates are sequential calls, preserving per-entry journal semantics). Values >256 KiB or documents that would exceed 4 MiB are rejected — binary assets never belong here.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app id: kebab-case segments of [a-z0-9], ≤64 chars.' },
      path: { type: 'string', required: true, description: 'Dot-separated key path (segments [A-Za-z0-9_-], ≤256 chars total).' },
      value: { type: 'json', required: true, description: 'Any JSON value for the key path (serialized ≤256 KiB; the document stays ≤4 MiB).' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const session = owner(exec).session
      const { appId, path } = args as { appId: string; path: string }
      const value = coerceJsonArg((args as { value?: unknown }).value) ?? null
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', `appId "${appId}" is not a legal app id (kebab-case segments of [a-z0-9], ≤64 chars).`, { appId }))
      }
      if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(path) || path.length > 256) {
        return json(toolError('PATH_INVALID', `path "${path}" is not a legal dot-separated key path (≤256 chars).`, { appId, path }))
      }
      writes += 1
      if (writes > 256) {
        return json(toolError('WRITE_LIMIT', 'This session exceeded the write budget (256 = the 32-per-turn cap with long-session headroom); batch remaining work into fewer, larger values.', { appId }))
      }
      if (consecutiveFailures >= 3) {
        return json(toolError('WRITE_CIRCUIT', 'Three consecutive write failures; read the document structure with app_data_read before the next attempt.', { appId }))
      }
      const causeId = `agent-${crypto.randomUUID()}`
      const result = await env.appStage.dataSet(session, appId, path, value as import('@ryanyujazz/dsh-app-stage/types').AppJsonValue, causeId)
      if (!result.ok) {
        consecutiveFailures += 1
        const code = result.code === 'NOT_FOUND' ? 'APP_NOT_INSTALLED' : result.code === 'NOT_READY' ? 'RUNTIME_BROKEN' : result.code
        return json(toolError(code, result.message, { appId, path }))
      }
      consecutiveFailures = 0
      return json({
        appId,
        path,
        dataVersion: String(result.rev),
        bytes: String(JSON.stringify(value ?? null).length),
      })
    },
  })
}


/**
 * `app_asset_write` (B9): copy one workspace file into an installed app's
 * runtime asset directory — the binary sibling of AppData, the only way
 * bytes reach an app origin (CSP 'self' reads no workspace). Passive media
 * only, extension and magic-byte verified; same name overwrites
 * (idempotent upsert — STORE_WRITE_FAILED retries safely).
 */
export function createAppAssetWriteTool(env: AppOperationEnvironment): ToolDefinition {
  let writes = 0
  return defineTool({
    name: 'app_asset_write',
    description: 'Copy one workspace file into an installed app\'s runtime asset directory, served same-origin from that app\'s own origin. Use it to deliver generated images and videos into apps (after create_image, before an invoke that places the asset); store the returned url reference in AppData, never the bytes. Writing an existing name overwrites it. Passive media only: png/jpg/webp/gif/mp4/webm (extension and content verified); per-asset 64 MiB, per-app 256 MiB.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app id from app_list (dev copies have no asset channel; publish first).' },
      name: { type: 'string', required: true, description: 'Asset key with a whitelisted extension, e.g. sunset.png — served at /deepcreator-app-stage/assets/<appId>/<name>.' },
      sourcePath: { type: 'string', required: true, description: 'Workspace-relative path of the source file (absolute paths and escapes are rejected).' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const session = owner(exec).session
      const { appId, name, sourcePath } = args as { appId: string; name: string; sourcePath: string }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', 'appId must be kebab-case segments of [a-z0-9], ≤64 chars.', { appId }))
      }
      if (!ASSET_NAME_PATTERN.test(name) || name.length > 128) {
        return json(toolError('NAME_INVALID', 'asset name must match ^[A-Za-z0-9][A-Za-z0-9._-]*$ (≤128 chars) with a whitelisted extension.', { name }))
      }
      if (writes >= 128) {
        return json(toolError('WRITE_CIRCUIT', 'asset write budget for this conversation is exhausted (128 = the 16-per-turn cap with long-session headroom; quota guards the disk surface); finish or start a new session.', { limit: '128' }))
      }
      writes += 1
      const result = await env.appStage.assetWrite(session, appId, name, sourcePath)
      if (!result.ok) {
        const fixes: Record<string, string> = {
          SOURCE_PATH_INVALID: 'pass a workspace-relative path; absolute paths and escapes are rejected.',
          SOURCE_NOT_FOUND: 'check the file exists in the workspace (create_image outputs land under output/).',
          MIME_UNSUPPORTED: 'use one of png/jpg/webp/gif/mp4/webm — and do not rename files from other formats.',
          ASSET_TOO_LARGE: 'compress or convert the asset; the per-asset cap is 64 MiB.',
          ASSET_QUOTA_EXCEEDED: 'run app_asset_list and overwrite large assets by name, or suggest the user reinstall the app.',
          STORE_WRITE_FAILED: 'the same-name upsert is idempotent — retrying this call is safe.',
        }
        const fix = fixes[result.code] === undefined ? '' : ` Fix: ${fixes[result.code]!}`
        return json(toolError(result.code, `${result.message}${fix}`, { appId, name }))
      }
      return json({ ...result })
    },
  })
}

/**
 * `app_asset_list` (B10): one installed app's runtime assets with quota
 * usage — the read side of the channel (inventory before placements,
 * reference recovery, headroom checks).
 */
export function createAppAssetListTool(env: AppOperationEnvironment): ToolDefinition {
  return defineTool({
    name: 'app_asset_list',
    description: 'List the runtime assets of an installed app with per-app quota usage. Use it before placements to reuse existing assets instead of duplicating writes, to recover url references when AppData mentions an asset you have not seen, and to check quota headroom before large writes.',
    parameters: {
      appId: { type: 'string', required: true, description: 'The installed app id from app_list.' },
    },
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      const appId = (args as { appId: string }).appId
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(appId) || appId.length > 64) {
        return json(toolError('APP_ID_INVALID', 'appId must be kebab-case segments of [a-z0-9], ≤64 chars.', { appId }))
      }
      const result = await env.appStage.assetList(owner(exec).session, appId)
      if (!result.ok) return json(toolError(result.code, result.message, { appId }))
      return json({ ...result })
    },
  })
}
