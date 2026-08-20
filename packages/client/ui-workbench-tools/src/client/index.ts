import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, type ReactNode } from 'react'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-workbench-remotes/client'
import {
  DeepCreatorIconPreview16, DeepCreatorIconReview16, DeepCreatorIconTerminal16,
} from '@ryanyujazz/dsh-client-ui-primitives'
import type { PanelTypeDefinition, WorkbenchPanelIconProps, WorkbenchPanelProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { BrowserPanel, ReviewPanel, TerminalPanel } from './Panels.tsx'
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
            typeId: 'review', target: path, parameters: { scope: 'turn', turn: String(turn), expand: 'all' }, reveal: true, reason: 'user',
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
  const terminalPanel: PanelComponent = props => createElement(TerminalPanel, { ...props, terminal })
  const turnChangeCard = (props: PropsRuntime<'deepcreator.conversation.chat.turnChanges'> & PropsLocale<'workbench-tools'>) => createElement(TurnChangeCard, {
    ...props,
    controller: reviewCacheFor(props.sessionId),
    workbench: ctx.workbench,
  })
  const providers: Array<{ definition: PanelTypeDefinition; panel: PanelComponent; icon: IconComponent }> = [
    { definition: { id:'review',label:()=>t('review'),scope:'workspace',order:4,supportsHome:true,supportsCreate:false,supportsMultipleInstances:true,minWidth:150,minHeight:260,preferredWidth:560,initialWidthRatio:1/2,closePolicy:'dispose',openParameters:{scope:'unstaged',expand:'all'} }, panel: reviewPanel, icon: DeepCreatorIconReview16 },
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
      disposers.push(ctx.slots.inject('deepcreator.conversation.chat.turnChanges', () => ctx.slots.register({
        name: 'deepcreator.conversation.chat.turnChanges', id: 'review', locale: NS,
      }, turnChangeCard)))
      disposers.push(ctx.locale.register(NS, { zh, en }))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-tools: atomic providers')
}
