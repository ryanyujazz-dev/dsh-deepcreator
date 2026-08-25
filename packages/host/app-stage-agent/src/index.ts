/**
 * The App Stage agent-session plugin — a PRESET ROW, never a bundle row.
 *
 * Tool availability is permission: every `app_*` tool registers here, inside
 * the app-stage preset's standing scope, so an ordinary session simply never
 * sees the App Stage tool face. The row registers on `agent/session-start`
 * (browser-playwright precedent); under the preset's standing scope that
 * event arrives for exactly the sessions joined to this preset, and each
 * registration files under the agent's own fiber and unwinds with it
 * (reversible registration invariant). Disabling the resident
 * `deepcreator-app-stage` row withdraws `ctx.appStage`, this row's inject
 * unsatisfies, and the whole stage — including its agent face — goes silent.
 *
 * M3: `app_publish` hangs its approval on the official `ctx.userQuestions`
 * seam (S1 spike outcome): the GUI renders the standard question card, the
 * promise has no timeout, an explicit cancel rejects ASK_CANCELLED, and a
 * session end aborts the tool's signal — the ask seam expresses every D10
 * semantic without new pending infrastructure.
 * @module @ryanyujazz/dsh-app-stage-agent
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the userQuestions Context merge (S1 approval seam).
import type {} from '@deepseek-ai/dsh-user-questions'
import { createAppListTool, createAppManifestTool, createAppPublishTool, type AppToolEnvironment } from './tools.ts'

/** Cordis plugin id inside the preset composition. */
export const name = 'app-stage-agent'

/** Resident registry face + the official user-questions seam back the tools. */
export const inject = ['appStage', 'userQuestions']

/**
 * Register the `app_*` face (`app_list`, `app_manifest`, `app_publish`) on
 * every agent composed from the app-stage preset.
 */
export function apply(ctx: Context): void {
  const env: AppToolEnvironment = { appStage: ctx.appStage }
  ctx.on('agent/session-start', ({ agent }: { agent: import('@deepseek-ai/dsh-agent').Agent }) => {
    agent.ctx.effect(() => {
      const list = agent.ctx.tools.register(createAppListTool(env))
      const manifest = agent.ctx.tools.register(createAppManifestTool(env))
      const publish = agent.ctx.tools.register(createAppPublishTool({ appStage: ctx.appStage, userQuestions: ctx.userQuestions }))
      return () => {
        publish()
        manifest()
        list()
      }
    }, 'app-stage-agent: tool face')
  })
}
