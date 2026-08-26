/**
 * The App Stage agent-session plugin — a PRESET ROW, never a bundle row.
 *
 * Tool availability is permission: every `app_*` tool registers here, inside
 * the app-stage preset's standing scope, so an ordinary session simply never
 * sees the App Stage tool face. A preset row's `apply` runs inside the
 * session's own agent fiber (the tool-bash pattern — register directly, no
 * lifecycle event), so the registrations live and die with that fiber: the
 * reversible-registration invariant for free, and no window where a session
 * exists without its tool face. Disabling the resident
 * `deepcreator-app-stage` row withdraws `ctx.appStage`, this row's inject
 * unsatisfies, and the whole stage — including its agent face — goes silent.
 *
 * `app_publish` hangs its approval on the official `ctx.userQuestions` seam
 * (S1 spike outcome): the GUI renders the standard question card, the
 * promise has no timeout, an explicit cancel rejects ASK_CANCELLED, and a
 * session end aborts the tool's signal — the ask seam expresses every D10
 * semantic without new pending infrastructure. That service stays a
 * HOST-plane row (composition line 36); preset sessions run inside the host
 * composition, so it is already present here without a preset row.
 * @module @ryanyujazz/dsh-app-stage-agent
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the userQuestions Context merge (S1 approval seam).
import type {} from '@deepseek-ai/dsh-user-questions'
import { createAppAssetDeleteTool, createAppAssetListTool, createAppAssetWriteTool, createAppDataReadTool, createAppDataWriteTool, createAppHistoryTool, createAppInvokeTool, createAppListTool, createAppManifestTool, createAppOpenTool, createAppPublishTool, createAppTakeoverTool, type AppOperationEnvironment, type AppToolEnvironment } from './tools.ts'

/** Cordis plugin id inside the preset composition. */
export const name = 'app-stage-agent'

/** Registry + tools + the official user-questions seam back the tool face. */
export const inject = ['appStage', 'userQuestions', 'tools']

/** Register the `app_*` face (`app_list`, `app_manifest`, `app_publish`, and
 * the M4 operation tools `app_invoke` / `app_open` / `app_data_read` /
 * `app_data_write`, and the M5 presence tool `app_takeover`). */
export function apply(ctx: Context): void {
  const env: AppToolEnvironment & AppOperationEnvironment = { appStage: ctx.appStage }
  ctx.tools.register(createAppListTool(env))
  ctx.tools.register(createAppManifestTool(env))
  ctx.tools.register(createAppPublishTool({ appStage: ctx.appStage, userQuestions: ctx.userQuestions }))
  ctx.tools.register(createAppInvokeTool(env))
  ctx.tools.register(createAppOpenTool(env))
  ctx.tools.register(createAppTakeoverTool(env))
  ctx.tools.register(createAppHistoryTool(env))
  ctx.tools.register(createAppAssetDeleteTool(env))
  ctx.tools.register(createAppDataReadTool(env))
  ctx.tools.register(createAppDataWriteTool(env))
  ctx.tools.register(createAppAssetWriteTool(env))
  ctx.tools.register(createAppAssetListTool(env))
}
