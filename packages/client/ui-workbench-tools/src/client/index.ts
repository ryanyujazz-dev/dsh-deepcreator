import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactNode } from 'react'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import {
  DeepCreatorIconArtifact16, DeepCreatorIconPreview16, DeepCreatorIconReview16, DeepCreatorIconTerminal16,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { ArtifactRendererProps, PanelTypeDefinition, WorkbenchPanelIconProps, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { ArtifactPanel, BrowserPanel, ReviewPanel, TerminalPanel } from './Panels.tsx'
import { en, NS, zh, type ToolsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'workbench-tools': ToolsKey } }

type PanelComponent = (props: WorkbenchPanelProps & PropsLocale<'workbench-tools'>) => ReactNode
type IconComponent = (props: { size?: number; className?: string }) => ReactNode

function iconRenderer(Icon: IconComponent) { return ({ size }: WorkbenchPanelIconProps) => Icon({ size }) }

function TextArtifact({ content }: ArtifactRendererProps) { return createElement('pre', null, content) }

export const inject = [
  'slots', 'workbench', 'locale', 'remote',
  'remote.artifacts', 'remote.review', 'remote.terminal-workbench',
]

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  // Renderers run outside this plugin's apply frame. Capture the concrete
  // service once so Cordis does not treat later namespace reads as undeclared
  // `remote.*` context injections.
  const remote = ctx.get('remote') as TypertClientRemote
  // Cordis returns a fresh traced Proxy for every associated namespace read.
  // Capture this namespace once: using remote['terminal-workbench'] inside a
  // React render would invalidate every Terminal effect on every render.
  const terminal = remote['terminal-workbench']
  const artifactPanel: PanelComponent = props => createElement(ArtifactPanel, { ...props, remote })
  const reviewPanel: PanelComponent = props => createElement(ReviewPanel, { ...props, remote })
  const terminalPanel: PanelComponent = props => createElement(TerminalPanel, { ...props, terminal })
  const providers: Array<{ definition: PanelTypeDefinition; panel: PanelComponent; icon: IconComponent }> = [
    { definition: { id:'artifact',label:()=>t('artifact'),scope:'session',order:2,supportsHome:true,supportsCreate:false,supportsMultipleInstances:true,minWidth:150,minHeight:260,preferredWidth:520,initialWidthRatio:1/3,closePolicy:'detach' }, panel: artifactPanel, icon: DeepCreatorIconArtifact16 },
    { definition: { id:'review',label:()=>t('review'),scope:'workspace',order:4,supportsHome:true,supportsCreate:false,supportsMultipleInstances:true,minWidth:150,minHeight:260,preferredWidth:560,initialWidthRatio:1/2,closePolicy:'dispose' }, panel: reviewPanel, icon: DeepCreatorIconReview16 },
    { definition: { id:'terminal',label:()=>t('terminal'),scope:'session',order:1,supportsHome:false,supportsCreate:true,supportsMultipleInstances:true,minWidth:150,minHeight:220,preferredWidth:520,initialWidthRatio:1/3,closePolicy:'provider-controlled',disabledWhenAddressed:true }, panel: terminalPanel, icon: DeepCreatorIconTerminal16 },
    { definition: { id:'browser',label:()=>t('browser'),scope:'session',order:5,supportsHome:true,supportsCreate:true,supportsMultipleInstances:true,minWidth:150,minHeight:280,preferredWidth:640,initialWidthRatio:1/2,closePolicy:'provider-controlled' }, panel: BrowserPanel, icon: DeepCreatorIconPreview16 },
  ]
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      for (const provider of providers) {
        disposers.push(ctx.workbench.registerType(provider.definition))
        disposers.push(ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({ name:'deepcreator.workbench.panel',id:provider.definition.id,locale:NS }, provider.panel)))
        disposers.push(ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name:'deepcreator.workbench.panel-icon',id:provider.definition.id }, iconRenderer(provider.icon))))
      }
      for (const kind of ['plan', 'document', 'code', 'report']) {
        disposers.push(ctx.slots.inject('deepcreator.workbench.artifact.renderer', () => ctx.slots.register({ name:'deepcreator.workbench.artifact.renderer',id:kind }, TextArtifact)))
      }
      disposers.push(ctx.locale.register(NS, { zh, en }))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-tools: atomic providers')
}
