import { existsSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { buildPlatformFacts } from './platform-facts.ts'

export { buildPlatformFacts, hasPowerShellSeven, type PlatformFactsInput } from './platform-facts.ts'

/** Cordis plugin name. */
export const name = 'platform-context'
/** Service required to register dynamic runtime context. */
export const inject = ['systemPrompt']

/**
 * Windows host facts as one dynamic runtime-context snapshot (`form:
 * "snapshot"`), ordered after the official sandbox and approval policies so
 * scripts are written with the right shell dialect from the first step. The
 * facts are detected once at plugin start; non-Windows hosts produce empty
 * text and register nothing, so macOS/Linux assemblies are byte-identical to
 * an uncomposed tree.
 */
export function apply(ctx: Context): void {
  const text = buildPlatformFacts({ platform: process.platform, env: process.env, fileExists: existsSync })
  if (text === '') return
  ctx.systemPrompt.context({
    name: 'deepcreator:platform',
    order: 120,
    text,
  })
}
