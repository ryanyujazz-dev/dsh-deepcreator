import type { Context } from '@deepseek-ai/cordis'
import type { TypertClientRemote, TypertDisposer } from '@deepseek-ai/dsh-typert-protocol'
import { TYPERT_REMOTE as ARTIFACTS_REMOTE } from '@ryanyujazz/dsh-artifacts/remote'
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import { TYPERT_REMOTE as REVIEW_REMOTE } from '@ryanyujazz/dsh-review/remote'
import type {} from '@ryanyujazz/dsh-review/remote'
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
    for (const contribution of [ARTIFACTS_REMOTE, REVIEW_REMOTE, TERMINAL_REMOTE]) {
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
