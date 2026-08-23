import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactNode } from 'react'
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import type {} from '@ryanyujazz/dsh-client-presentation/client'
import type { PresentationProvider } from '@ryanyujazz/dsh-client-presentation/client'
import type { PanelTypeDefinition, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { ArtifactIcon } from './ArtifactIcon.tsx'
import { ArtifactPanel } from './ArtifactPanel.tsx'
import { ArtifactCodeRenderer } from './ArtifactCodeRenderer.tsx'
import { ArtifactTurnCard } from './ArtifactTurnCard.tsx'
import { producedForClosing, registerArtifactNodeDefinition } from './artifact-node-definition.ts'
import { registerArtifactsConversationView } from './artifacts-snapshot-builder.ts'
import { artifactParentDirectory } from './artifact-view-model.ts'
import { en, NS, zh, type ArtifactKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'workbench-artifact': ArtifactKey } }

/** Required services: Workbench panel Slots, the locale service, the mounted artifacts remote, and the conversation projection registries. */
export const inject = [
  'slots', 'workbench', 'workspaces', 'locale', 'remote', 'remote.artifacts',
  'conversationEvents', 'conversationViews',
  'presentation',
]

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  // Renderers run outside this plugin's apply frame. Capture the concrete
  // service once so Cordis does not treat later namespace reads as undeclared
  // `remote.*` context injections.
  const remote = ctx.get('remote') as TypertClientRemote
  // Cordis returns a fresh traced Proxy for every associated namespace read.
  // Capture this namespace once: using remote['artifacts'] inside a React
  // render would invalidate every Artifact effect on every render.
  const artifacts = remote['artifacts']
  const openContainingFolder = (path: string) => {
    void ctx.workspaces.openPath(artifactParentDirectory(path)).catch((reason: unknown) => {
      console.warn('artifact containing folder open rejected:', reason)
    })
  }
  const panel = (props: WorkbenchPanelProps & PropsLocale<'workbench-artifact'>): ReactNode =>
    createElement(ArtifactPanel, { ...props, artifacts, openContainingFolder })
  const turnCard = (props: PropsRuntime<'conversation.chat.turnTail'> & PropsLocale<'workbench-artifact'> & { matched: readonly string[] }): ReactNode =>
    createElement(ArtifactTurnCard, {
      ...props,
      openArtifacts: () => { ctx.workbench.activate('artifact') },
    })
  const definition: PanelTypeDefinition = {
    id: 'artifact', label: () => t('type'), scope: 'session', order: 3, supportsHome: true, supportsCreate: false,
    supportsMultipleInstances: true, minWidth: 150, minHeight: 260, preferredWidth: 520, initialWidthRatio: 1 / 3, closePolicy: 'detach',
  }
  const presenter: PresentationProvider = {
    id: 'workbench-artifact', priority: 100, resourceKinds: ['artifact'], modes: ['none'], surfaceHost: false,
    async present(_request, resource) {
      if (!ctx.workbench.types.list().some(type => type.id === 'artifact')) return { status: 'unavailable', presenterId: 'workbench-artifact', failure: { code: 'PANEL_UNAVAILABLE', stage: 'present', retryable: true, message: 'The Artifact panel type is not registered in this client.' } }
      ctx.workbench.present({ typeId: 'artifact', instanceId: resource.id, route: 'instance', reveal: true, reason: 'agent' })
      return { status: 'presented', presenterId: 'workbench-artifact' }
    },
  }
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(ctx.workbench.registerType(definition))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({ name: 'deepcreator.workbench.panel', id: 'artifact', locale: NS }, panel)))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name: 'deepcreator.workbench.panel-icon', id: 'artifact' }, ArtifactIcon)))
      disposers.push(ctx.slots.inject('deepcreator.workbench.artifact.renderer', () => ctx.slots.register({ name: 'deepcreator.workbench.artifact.renderer', id: 'code' }, ArtifactCodeRenderer)))
      disposers.push(ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
        name: 'conversation.chat.turnTail',
        priority: -100,
        select: owner => {
          const paths = producedForClosing(owner.turn.data.get('workbench-artifact'), owner.seq)
          return paths.length === 0 ? null : paths
        },
        locale: NS,
      }, turnCard)))
      disposers.push(registerArtifactNodeDefinition(ctx))
      disposers.push(registerArtifactsConversationView(ctx))
      disposers.push(ctx.locale.register(NS, { zh, en }))
      if (ctx.presentation !== undefined) {
        disposers.push(ctx.presentation.providers.register(presenter))
        if (ctx.workbench.dismissals !== undefined) disposers.push(ctx.workbench.dismissals.subscribe(() => { const dismissal = ctx.workbench.dismissals.getSnapshot(); if (dismissal?.typeId === 'artifact') ctx.presentation.dismiss('artifact', dismissal.instanceId) }))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-artifact: atomic provider')
}
