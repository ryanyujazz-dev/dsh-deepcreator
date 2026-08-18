import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactNode } from 'react'
import type {} from '@ryanyujazz/dsh-artifacts/remote'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import type { PanelTypeDefinition, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { ArtifactIcon } from './ArtifactIcon.tsx'
import { ArtifactPanel } from './ArtifactPanel.tsx'
import { registerArtifactNodeDefinition } from './artifact-node-definition.ts'
import { registerArtifactsConversationView } from './artifacts-snapshot-builder.ts'
import { en, NS, zh, type ArtifactKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'workbench-artifact': ArtifactKey } }

/** Required services: Workbench panel Slots, the locale service, the mounted artifacts remote, and the conversation projection registries. */
export const inject = [
  'slots', 'workbench', 'locale', 'remote', 'remote.artifacts',
  'conversationEvents', 'conversationViews',
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
  const panel = (props: WorkbenchPanelProps & PropsLocale<'workbench-artifact'>): ReactNode =>
    createElement(ArtifactPanel, { ...props, artifacts })
  const definition: PanelTypeDefinition = {
    id: 'artifact', label: () => t('type'), scope: 'session', order: 3, supportsHome: true, supportsCreate: false,
    supportsMultipleInstances: true, minWidth: 150, minHeight: 260, preferredWidth: 520, initialWidthRatio: 1 / 3, closePolicy: 'detach',
  }
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(ctx.workbench.registerType(definition))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({ name: 'deepcreator.workbench.panel', id: 'artifact', locale: NS }, panel)))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name: 'deepcreator.workbench.panel-icon', id: 'artifact' }, ArtifactIcon)))
      disposers.push(registerArtifactNodeDefinition(ctx))
      disposers.push(registerArtifactsConversationView(ctx))
      disposers.push(ctx.locale.register(NS, { zh, en }))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-artifact: atomic provider')
}
