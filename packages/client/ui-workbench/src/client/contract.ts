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
  /** Real file path per file-backed tab id; non-file tabs stay icon-free. */
  tabFilePaths?: Readonly<Record<string, string>>
}

export interface PanelTypeDefinition {
  id: string
  label: () => string
  scope: PanelScope
  /** Entry-strip position: lower comes first. Unordered types keep registration order after all ordered ones. */
  order?: number
  supportsHome: boolean
  supportsCreate: boolean
  supportsMultipleInstances: boolean
  minWidth: number
  minHeight: number
  preferredWidth?: number
  preferredHeight?: number
  closePolicy: PanelClosePolicy
  /** Agent-scoped providers stay visible but inert for catalog-addressed subagents. */
  disabledWhenAddressed?: boolean
  /** Provider parameters emitted when the shared panel control opens this type. */
  openParameters?: Readonly<Record<string, string>>
}

export interface WorkbenchPresentRequest {
  typeId: string
  instanceId?: string
  route?: PanelRoute
  /**
   * Provider-defined focus target carried to the addressed panel's owner
   * props (`reveal`); the provider interprets the string — the review panel
   * treats it as a workspace file path.
   */
  target?: string
  /** Provider-defined presentation parameters; valid with or without a focus target. */
  parameters?: Readonly<Record<string, string>>
  reveal?: boolean
  reason: 'user' | 'agent' | 'system'
}

export interface WorkbenchService {
  registerType(definition: PanelTypeDefinition): () => void
  /** Registered panel-type definitions (availability checks by id). */
  types: { list(): readonly PanelTypeDefinition[] }
  /** Types currently visible in the live topology (controller-published). */
  visibility: { list(): readonly string[] }
  /** Explicit user dismissal edges. Responsive hiding never emits one. */
  dismissals: {
    getSnapshot(): { sequence: number; typeId: string; instanceId?: string } | null
    subscribe(listener: () => void): () => void
  }
  present(request: WorkbenchPresentRequest): void
  activate(typeId: string, instanceId?: string): void
  /** Present the type as a user action and focus `target` inside its panel. */
  reveal(typeId: string, target: string): void
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
  /** Replace or merge one presentation-only identity without emitting a user-dismissal edge. */
  replaceInstanceId(fromInstanceId: string, toInstanceId: string): void
  showHome(): void
  contributeHeaderActions(contribution: WorkbenchPanelHeaderContribution): () => void
  contributePanelInfo(contribution: WorkbenchPanelInfoContribution): () => void
  renderArtifact(owner: ArtifactRendererOwnerProps): ReactNode
  /**
   * Pending provider presentation from the latest `reveal`/`present` request
   * carrying a target and/or parameters. `nonce` is the publishing command's
   * sequence, so repeating the same request re-fires; providers consume it
   * from an effect keyed on the nonce. Undefined on panels the request did
   * not address.
   */
  reveal?: { target?: string; parameters?: Readonly<Record<string, string>>; nonce: number } | undefined
  /**
   * Whether this group's cell is actually rendered. Hidden and
   * responsive-removed Groups stay mounted (display:none) with `visible:
   * false`; providers gate background work (watches, polling, refreshes) on
   * it.
   */
  visible?: boolean | undefined
}

export interface WorkbenchPanelIconOwnerProps {
  size: number
  /** Whether the panel group is currently visible; lets icons show read state. */
  visible: boolean
}

export interface ArtifactRendererOwnerProps {
  artifactId: string
  content: string
  /** Kind/mime are optional: the official produced-files fact carries no metadata. */
  kind?: string
  mime?: string
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
