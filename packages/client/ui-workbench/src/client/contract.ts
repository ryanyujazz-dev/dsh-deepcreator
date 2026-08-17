import type { PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DetailsOwnerProps } from '@ryanyujazz/dsh-client-ui-layout/client'
import type { ReactNode } from 'react'
import type { createWorkbenchStore } from './store.ts'
import type { WorkbenchController } from './service.ts'

export type PanelScope = 'session' | 'workspace' | 'root'
export type PanelClosePolicy = 'dispose' | 'detach' | 'provider-controlled'
export type PanelRoute = 'home' | 'instance'

export interface WorkbenchPanelHeaderContribution {
  /** Reserved for a create-tab plus action. */
  left?: ReactNode
  /** All other Provider-owned Header actions. */
  right?: ReactNode
}

/**
 * Provider-supplied presentation names. Tab instance ids stay the identity
 * for activation, closing and persistence; these only change what is shown.
 */
export interface WorkbenchPanelInfoContribution {
  /** Appended to the group title and its accessible name, e.g. the shell program. */
  titleSuffix?: string
  /** Display label per tab instance id; unmapped tabs keep showing their id. */
  tabLabels?: Readonly<Record<string, string>>
}

export interface PanelTypeDefinition {
  id: string
  label: () => string
  scope: PanelScope
  supportsHome: boolean
  supportsCreate: boolean
  supportsMultipleInstances: boolean
  minWidth: number
  minHeight: number
  preferredWidth?: number
  preferredHeight?: number
  /** Initial Workbench share of Stage width when this is the first visible type. */
  initialWidthRatio?: number
  closePolicy: PanelClosePolicy
  /** Agent-scoped providers stay visible but inert for catalog-addressed subagents. */
  disabledWhenAddressed?: boolean
}

export interface WorkbenchPresentRequest {
  typeId: string
  instanceId?: string
  route?: PanelRoute
  reveal?: boolean
  reason: 'user' | 'agent' | 'system'
}

export interface WorkbenchService {
  registerType(definition: PanelTypeDefinition): () => void
  present(request: WorkbenchPresentRequest): void
  activate(typeId: string, instanceId?: string): void
  hide(typeId: string): void
  closeTab(typeId: string, instanceId: string): void
  focus(typeId: string): void
  restoreFocus(): void
}

export interface WorkbenchPanelOwnerProps {
  typeId: string
  route: PanelRoute
  tabs: readonly string[]
  activeInstanceId?: string
  openInstance(instanceId: string): void
  activateInstance(instanceId: string): void
  closeInstance(instanceId: string): void
  showHome(): void
  contributeHeaderActions(contribution: WorkbenchPanelHeaderContribution): () => void
  contributePanelInfo(contribution: WorkbenchPanelInfoContribution): () => void
  renderArtifact(owner: ArtifactRendererOwnerProps): ReactNode
}

export interface WorkbenchPanelIconOwnerProps { size: number }

export interface ArtifactRendererOwnerProps {
  artifactId: string
  kind: string
  mime?: string
  content: string
}

export type WorkbenchStore = ReturnType<typeof createWorkbenchStore>

export type WorkbenchRootProps = PropsRuntime<'details'>
  & PropsRenderSlots<'deepcreator.workbench.panel' | 'deepcreator.workbench.artifact.renderer'>
  & PropsStore<WorkbenchStore>
  & PropsLocale<'workbench'>
  & DetailsOwnerProps
  & { controller: WorkbenchController }

export type WorkbenchControlsProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsRenderSlots<'deepcreator.workbench.panel-icon'>
  & PropsStore<WorkbenchStore>
  & PropsLocale<'workbench'>
  & { controller: WorkbenchController; addressed: boolean }

export type WorkbenchPanelProps = PropsRuntime<'deepcreator.workbench.panel'> & WorkbenchPanelOwnerProps
export type WorkbenchPanelIconProps = PropsRuntime<'deepcreator.workbench.panel-icon'> & WorkbenchPanelIconOwnerProps
export type ArtifactRendererProps = PropsRuntime<'deepcreator.workbench.artifact.renderer'> & ArtifactRendererOwnerProps
