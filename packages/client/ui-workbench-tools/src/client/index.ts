import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactNode } from 'react'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import type {} from '@ryanyujazz/dsh-client-presentation/client'
import type { PresentationProvider } from '@ryanyujazz/dsh-client-presentation/client'
import { DeepCreatorIconReview16, DeepCreatorIconTerminal16 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { PanelTypeDefinition, WorkbenchPanelIconProps, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { ReviewPanel, TerminalPanel } from './Panels.tsx'
import { TurnChangeCard } from './TurnChangeCard.tsx'
import { ReviewCacheController } from './review-cache.ts'
import { en, NS, zh, type ToolsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'workbench-tools': ToolsKey } }

type PanelComponent = (props: WorkbenchPanelProps & PropsLocale<'workbench-tools'>) => ReactNode
type IconComponent = (props: { size?: number; className?: string }) => ReactNode

function iconRenderer(Icon: IconComponent) { return ({ size }: WorkbenchPanelIconProps) => Icon({ size }) }

export const inject = [
  'slots', 'workbench', 'locale', 'remote', 'sessions',
  'remote.review', 'remote.terminal-workbench',
  'presentation',
  'connection',
]

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  // Renderers run outside this plugin's apply frame. Capture the concrete
  // service once so Cordis does not treat later namespace reads as undeclared
  // `remote.*` context injections.
  const remote = ctx.get('remote') as TypertClientRemote
  const loopback = (ctx.get('connection') as ConnectionHandle).isLoopback
  // Cordis returns a fresh traced Proxy for every associated namespace read.
  // Capture this namespace once: using remote['terminal-workbench'] inside a
  // React render would invalidate every Terminal effect on every render.
  const terminal = loopback ? remote['terminal-workbench'] : undefined
  // Review caches are session data planes, not panel state: one controller
  // per session starts when the session becomes current (before any panel
  // opens, so review data is warm on first open) and dies when the session
  // leaves the list. The panel is a view over its snapshot.
  const reviewCaches = new Map<SessionId, ReviewCacheController>()
  const reviewCacheFor = (sessionId: SessionId): ReviewCacheController => {
    const existing = reviewCaches.get(sessionId)
    if (existing !== undefined) return existing
    const session = ctx.sessions.binding(sessionId)?.session
    const controller = new ReviewCacheController({
      remote,
      sessionId,
      session: session ?? {
        // Defensive: the staged session always resolves a binding; a stale
        // panel render must still get a cache, inert until the real feed
        // exists.
        subscribe: () => () => {},
        getSnapshot: () => ({ nodes: [], turnEnds: new Map() }) as never,
      },
    })
    reviewCaches.set(sessionId, controller)
    return controller
  }
  if (typeof ctx.provide === 'function') ctx.provide('turnChangeNavigation', {
    open(sessionId, turn, path) {
      const controller = reviewCacheFor(sessionId)
      // Resolve against a fresh history snapshot. A synchronous cache miss is
      // not evidence that the turn/file is resolved — it commonly means the
      // controller's initial history request has not completed yet.
      void controller.resolveTurnFile(turn, path).then(state => {
        if (state === 'pending') {
          ctx.workbench.present({
            typeId: 'review', target: path, parameters: { scope: 'turn', turn: String(turn) }, reveal: true, reason: 'user',
          })
          return
        }
        if (state === 'unknown') {
          // Missing history is not proof that a mutation was resolved. The
          // turn-start snapshot may still be settling; keep the click on its
          // owning Turn so a subsequent Host read cannot drift to a Git scope.
          ctx.workbench.present({
            typeId: 'review', target: path, parameters: { scope: 'turn', turn: String(turn) }, reveal: true, reason: 'user',
          })
          return
        }
        if (ctx.workbench.types.list().some(definition => definition.id === 'artifact')) {
          ctx.workbench.activate('artifact', path)
          return
        }
        // A composition without Artifact retains the pre-integration fallback.
        ctx.workbench.reveal('review', path)
      })
      return true
    },
  })
  ctx.effect(() => {
    const sync = () => {
      const state = ctx.sessions.list.getSnapshot()
      for (const [id, controller] of reviewCaches) {
        if (state.ids.includes(id)) continue
        controller.dispose()
        reviewCaches.delete(id)
      }
      const current = state.current
      if (current !== undefined && !reviewCaches.has(current)) reviewCacheFor(current)
    }
    const unsubscribe = ctx.sessions.list.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      for (const controller of reviewCaches.values()) controller.dispose()
      reviewCaches.clear()
    }
  }, 'ui-workbench-tools: review caches')
  const reviewPanel: PanelComponent = props => createElement(ReviewPanel, { ...props, controller: reviewCacheFor(props.sessionId) })
  const turnChangeCard = (props: PropsRuntime<'deepcreator.conversation.chat.turnChanges'> & PropsLocale<'workbench-tools'>) => createElement(TurnChangeCard, {
    ...props,
    controller: reviewCacheFor(props.sessionId),
    workbench: ctx.workbench,
  })
  const providers: Array<{ definition: PanelTypeDefinition; panel: PanelComponent; icon: IconComponent }> = [
    { definition: { id:'review',label:()=>t('review'),scope:'workspace',order:4,supportsHome:true,supportsCreate:false,supportsMultipleInstances:true,minWidth:150,minHeight:260,preferredWidth:560,closePolicy:'dispose',openParameters:{scope:'unstaged'} }, panel: reviewPanel, icon: DeepCreatorIconReview16 },
  ]
  if (terminal !== undefined) providers.push({
    definition: { id:'terminal',label:()=>t('terminal'),scope:'session',order:1,supportsHome:false,supportsCreate:true,supportsMultipleInstances:true,minWidth:150,minHeight:220,preferredWidth:520,closePolicy:'provider-controlled',disabledWhenAddressed:true },
    panel: props => createElement(TerminalPanel, { ...props, terminal }),
    icon: DeepCreatorIconTerminal16,
  })
  const reviewPresenter: PresentationProvider = {
    id: 'workbench-review', priority: 100, resourceKinds: ['review'], modes: ['none'], surfaceHost: false,
    async present(_request, resource) {
      if (!ctx.workbench.types.list().some(type => type.id === 'review')) return { status: 'unavailable', presenterId: 'workbench-review', failure: { code: 'PANEL_UNAVAILABLE', stage: 'present', retryable: true, message: 'The Review panel type is not registered in this client.' } }
      ctx.workbench.present({ typeId: 'review', ...(resource.id === 'home' ? {} : { target: resource.id }), reveal: true, reason: 'agent' })
      return { status: 'presented', presenterId: 'workbench-review' }
    },
  }
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      for (const provider of providers) {
        disposers.push(ctx.workbench.registerType(provider.definition))
        disposers.push(ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({ name:'deepcreator.workbench.panel',id:provider.definition.id,locale:NS }, provider.panel)))
        disposers.push(ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name:'deepcreator.workbench.panel-icon',id:provider.definition.id }, iconRenderer(provider.icon))))
      }
      disposers.push(ctx.slots.inject('deepcreator.conversation.chat.turnChanges', () => ctx.slots.register({
        name: 'deepcreator.conversation.chat.turnChanges', id: 'review', locale: NS,
      }, turnChangeCard)))
      disposers.push(ctx.locale.register(NS, { zh, en }))
      if (ctx.presentation !== undefined) {
        disposers.push(ctx.presentation.providers.register(reviewPresenter))
        if (ctx.workbench.dismissals !== undefined) disposers.push(ctx.workbench.dismissals.subscribe(() => { const dismissal = ctx.workbench.dismissals.getSnapshot(); if (dismissal?.typeId === 'review') ctx.presentation.dismiss('review', dismissal.instanceId) }))
      }
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-tools: atomic providers')
}
