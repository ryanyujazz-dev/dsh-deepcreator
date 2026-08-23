import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-presentation/remote'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import { PresentationClientRuntime, type PresentationRemoteClient } from './runtime.ts'

declare module '@deepseek-ai/cordis' { interface Context { presentation: PresentationClientRuntime } }
export const inject = ['remote', 'remote.presentation', 'sessions']

export function apply(ctx: ClientContext): void {
  const remote = (ctx.get('remote') as TypertClientRemote)['presentation'] as unknown as PresentationRemoteClient
  const presentation = new PresentationClientRuntime(remote, () => ctx.sessions.list.getSnapshot().current)
  ctx.provide('presentation', presentation)
  ctx.effect(() => { const stop = presentation.start(); return () => { stop(); presentation.dispose() } }, 'client-presentation: claim loop')
}

export * from './runtime.ts'
