import { Service, type Context } from '@deepseek-ai/cordis'
import type { PanelTypeDefinition, WorkbenchPresentRequest, WorkbenchService } from './contract.ts'
import type { ILayout } from '@ryanyujazz/dsh-client-ui-layout/client'

export type WorkbenchCommand = {
  sequence: number
  action:
    | { kind: 'present'; request: WorkbenchPresentRequest }
    | { kind: 'hide'; typeId: string }
    | { kind: 'close-tab'; typeId: string; instanceId: string }
    | { kind: 'focus'; typeId: string }
    | { kind: 'restore-focus' }
}

const EMPTY_COMMAND: WorkbenchCommand | null = null

export class WorkbenchController extends Service implements WorkbenchService {
  // Cordis may expose a traced service as an Object.create()-derived view. Keep
  // every mutable value behind one inherited reference so all traced views and
  // the owner observe the same state instead of shadowing scalar properties.
  private readonly state = {
    typeDefinitions: new Map<string, PanelTypeDefinition>(),
    typeListeners: new Set<() => void>(),
    commandListeners: new Set<() => void>(),
    visibilityListeners: new Set<() => void>(),
    typeVersion: 0,
    visibilityVersion: 0,
    visibleTypeIds: [] as string[],
    command: EMPTY_COMMAND as WorkbenchCommand | null,
    sequence: 0,
  }

  constructor(ctx: Context, private readonly layoutService: ILayout) {
    super(ctx, 'workbench')
  }

  readonly layout = {
    open: (width: number): void => { this.layoutService.setWorkbenchWidth(width) },
    close: (): void => { this.layoutService.closeDetails() },
    focus: (focused: boolean): void => { this.layoutService.setWorkbenchFocused(focused) },
  }

  readonly types = {
    list: (): readonly PanelTypeDefinition[] => [...this.state.typeDefinitions.values()],
    version: (): number => this.state.typeVersion,
    subscribe: (listener: () => void): (() => void) => {
      this.state.typeListeners.add(listener)
      return () => { this.state.typeListeners.delete(listener) }
    },
  }

  readonly commands = {
    getSnapshot: (): WorkbenchCommand | null => this.state.command,
    subscribe: (listener: () => void): (() => void) => {
      this.state.commandListeners.add(listener)
      return () => { this.state.commandListeners.delete(listener) }
    },
  }

  readonly visibility = {
    list: (): readonly string[] => this.state.visibleTypeIds,
    version: (): number => this.state.visibilityVersion,
    subscribe: (listener: () => void): (() => void) => {
      this.state.visibilityListeners.add(listener)
      return () => { this.state.visibilityListeners.delete(listener) }
    },
  }

  setVisibleTypes(typeIds: readonly string[]): void {
    if (typeIds.length === this.state.visibleTypeIds.length && typeIds.every((id, index) => id === this.state.visibleTypeIds[index])) return
    this.state.visibleTypeIds = [...typeIds]
    this.state.visibilityVersion += 1
    for (const listener of this.state.visibilityListeners) listener()
  }

  registerType(definition: PanelTypeDefinition): () => void {
    if (this.state.typeDefinitions.has(definition.id)) throw new Error(`workbench: panel type "${definition.id}" is already registered`)
    this.state.typeDefinitions.set(definition.id, definition)
    this.publishTypes()
    return () => {
      if (this.state.typeDefinitions.get(definition.id) !== definition) return
      this.state.typeDefinitions.delete(definition.id)
      this.publishTypes()
    }
  }

  present(request: WorkbenchPresentRequest): void {
    if (!this.state.typeDefinitions.has(request.typeId)) throw new Error(`workbench: unknown panel type "${request.typeId}"`)
    this.publishCommand({ kind: 'present', request })
  }

  activate(typeId: string, instanceId?: string): void {
    this.present({ typeId, ...(instanceId === undefined ? {} : { instanceId }), route: instanceId === undefined ? 'home' : 'instance', reveal: true, reason: 'user' })
  }

  hide(typeId: string): void { this.publishCommand({ kind: 'hide', typeId }) }
  closeTab(typeId: string, instanceId: string): void { this.publishCommand({ kind: 'close-tab', typeId, instanceId }) }
  focus(typeId: string): void { this.publishCommand({ kind: 'focus', typeId }) }
  restoreFocus(): void { this.publishCommand({ kind: 'restore-focus' }) }

  private publishTypes(): void {
    this.state.typeVersion += 1
    for (const listener of this.state.typeListeners) listener()
  }

  private publishCommand(action: WorkbenchCommand['action']): void {
    this.state.command = { sequence: ++this.state.sequence, action }
    for (const listener of this.state.commandListeners) listener()
  }
}
