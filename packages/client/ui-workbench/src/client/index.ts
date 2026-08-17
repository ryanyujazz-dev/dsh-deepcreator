import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-ui-conversation/client'
import type {} from '@ryanyujazz/dsh-client-ui-layout/client'
import type { ILayout } from '@ryanyujazz/dsh-client-ui-layout/client'
import type { WorkbenchPanelIconOwnerProps, WorkbenchPanelOwnerProps, ArtifactRendererOwnerProps } from './contract.ts'
import { WorkbenchController } from './service.ts'
import { createWorkbenchStore, prepareWorkbenchPersistence } from './store.ts'
import { WorkbenchRoot } from './WorkbenchRoot.tsx'
import { WorkbenchControls } from './WorkbenchControls.tsx'
import { en, NS, zh, type WorkbenchKey } from './locales.ts'

export type {
  ArtifactRendererOwnerProps, ArtifactRendererProps, PanelClosePolicy, PanelRoute, PanelScope,
  PanelTypeDefinition, WorkbenchPanelIconOwnerProps, WorkbenchPanelIconProps, WorkbenchPanelOwnerProps,
  WorkbenchPanelProps, WorkbenchPanelHeaderContribution, WorkbenchPresentRequest, WorkbenchService,
} from './contract.ts'
export { WorkbenchController } from './service.ts'
export { createWorkbenchStore, prepareWorkbenchPersistence, WORKBENCH_PERSIST_KEY } from './store.ts'
export type { WorkbenchGroupState, WorkbenchState, WorkbenchTrackState } from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { workbench: import('./contract.ts').WorkbenchService }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { workbench: WorkbenchKey }
  interface SlotMap {
    'deepcreator.workbench.panel': { kind: 'list'; scope: 'session'; owner: WorkbenchPanelOwnerProps }
    'deepcreator.workbench.panel-icon': { kind: 'list'; scope: 'session'; owner: WorkbenchPanelIconOwnerProps }
    'deepcreator.workbench.artifact.renderer': { kind: 'list'; scope: 'session'; owner: ArtifactRendererOwnerProps }
  }
}

export const inject = ['slots', 'layout', 'locale', 'sessions']

export function apply(ctx: ClientContext): void {
  if (typeof localStorage !== 'undefined') prepareWorkbenchPersistence(localStorage)
  // LayoutController owns JS-private wiring; retain the concrete service
  // rather than Cordis' traced Object.create() view.
  const controller = new WorkbenchController(ctx, ctx.get('layout') as ILayout)
  const store = createWorkbenchStore()

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workbench: dictionaries')
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    locale: NS,
    store,
    children: {
      'deepcreator.workbench.panel': { kind: 'list', scope: 'session' },
      'deepcreator.workbench.artifact.renderer': { kind: 'list', scope: 'session' },
    },
    inject: () => ({ controller }),
  }, WorkbenchRoot))

  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'workbench-controls',
    order: -20,
    locale: NS,
    store,
    children: {
      'deepcreator.workbench.panel-icon': { kind: 'list', scope: 'session' },
    },
    inject: (sessionId) => ({ controller, addressed: ctx.sessions.subagentAddress(sessionId) !== undefined }),
  }, WorkbenchControls))
}
