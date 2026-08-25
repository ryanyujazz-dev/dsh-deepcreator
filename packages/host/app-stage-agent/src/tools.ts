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
import { dshHome, installedVersionDir, listInstalled, scanDevRoot } from '@ryanyujazz/dsh-app-stage'

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
