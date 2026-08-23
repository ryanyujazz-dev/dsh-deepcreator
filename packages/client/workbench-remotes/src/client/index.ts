import type { Context } from '@deepseek-ai/cordis'
import type { TypertClientRemote, TypertDisposer } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT_REMOTE as BROWSER_REMOTE } from '@ryanyujazz/dsh-browser/remote'
import type {} from '@ryanyujazz/dsh-browser/remote'
import { TYPERT_REMOTE as PRESENTATION_REMOTE } from '@ryanyujazz/dsh-presentation/remote'
import type {} from '@ryanyujazz/dsh-presentation/remote'
import { TYPERT_REMOTE as ARTIFACTS_REMOTE } from '@ryanyujazz/dsh-artifacts/remote'
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import { TYPERT_REMOTE as JOBS_ADMIN_REMOTE } from '@ryanyujazz/dsh-jobs-admin/remote'
import type {} from '@ryanyujazz/dsh-jobs-admin/remote'
import { TYPERT_REMOTE as REVIEW_REMOTE } from '@ryanyujazz/dsh-review/remote'
import type {} from '@ryanyujazz/dsh-review/remote'
import { TYPERT_REMOTE as SESSION_ADMIN_REMOTE } from '@ryanyujazz/dsh-session-admin/remote'
import type {} from '@ryanyujazz/dsh-session-admin/remote'
import { TYPERT_REMOTE as TERMINAL_REMOTE } from '@ryanyujazz/dsh-terminal-workbench/remote'
import type {} from '@ryanyujazz/dsh-terminal-workbench/remote'

declare module '@deepseek-ai/cordis' {
  interface Context {
    remote: TypertClientRemote
  }
}

export const inject = ['remote']

/** Mount only the Workbench Host capabilities selected by DeepCreator. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: TypertDisposer[] = []
  try {
    for (const contribution of [ARTIFACTS_REMOTE, BROWSER_REMOTE, PRESENTATION_REMOTE, JOBS_ADMIN_REMOTE, REVIEW_REMOTE, SESSION_ADMIN_REMOTE, TERMINAL_REMOTE]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
