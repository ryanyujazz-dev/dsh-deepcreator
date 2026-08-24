/**
 * Activity panel provider. Home route: this session's background jobs (live
 * timers, stoppable through the `jobs-admin` Host remote) plus its subagent
 * catalog. Each subagent opens as a real Workbench tab — a panel instance
 * keyed by the child session id — whose body mounts the real child Session
 * transcript without changing the current conversation. Background jobs open
 * namespaced instances derived from the same official JobView snapshot; no
 * output cursor is consumed by presentation. Views receive the
 * Host actions as plain callbacks through the slot inject; no React
 * component touches Cordis context or the RPC surface.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-client-locale/client'
// Type-only: merges the 'jobs-admin' namespace into TypertClientRemote.
import type {} from '@ryanyujazz/dsh-jobs-admin/remote'
import { DeepCreatorIconActivity16 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelIconProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import type { ActivityInjected } from './injected.ts'
import { en, NS, zh, type ActivityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'workbench-activity': ActivityKey } }

export type { ActivityInjected } from './injected.ts'

function ActivityIcon({ size }: WorkbenchPanelIconProps) { return DeepCreatorIconActivity16({ size }) }

export const inject = ['slots', 'workbench', 'locale', 'remote', 'sessions', 'remote.jobs-admin']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  // Captured once outside React: Cordis returns a fresh traced Proxy for every
  // namespace read, so a render-time read would churn every subscription.
  const remote = ctx.get('remote') as TypertClientRemote
  const jobsAdmin = remote['jobs-admin']
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(ctx.workbench.registerType({
        id: 'activity', label: () => t('type'), scope: 'session', order: 2, supportsHome: true, supportsCreate: false,
        supportsMultipleInstances: true, minWidth: 150, minHeight: 220, preferredWidth: 360, closePolicy: 'dispose',
      }))
      const injected = (): ActivityInjected => ({
        stopJob: async (sessionId, jobId) => {
          const wire = await jobsAdmin.stop(sessionId, jobId)
          return wire.ok ? wire.value : { ok: false, code: 'KILL_FAILED', message: wire.error.message }
        },
        subagentOverview: async parentSessionId => {
          const wire = await jobsAdmin.subagentOverview(parentSessionId)
          return wire.ok ? wire.value : { ok: false, code: 'READ_FAILED', message: wire.error.message }
        },
        openInConversation: address => { ctx.sessions.openSubagent(address) },
        closeFromConversation: parentSessionId => { ctx.sessions.open(parentSessionId) },
      })
      // Addressed-child continuity: opening a subagent in the conversation
      // area re-scopes the current session to the child, whose own Workbench
      // topology starts empty. On every jump (idle→addressed transition)
      // present the Activity panel at its home route so the panel the user
      // jumped from stays at hand — content anchors to the parent's home
      // either way. Per-transition only: hiding the panel while reading the
      // child stays hidden until the next jump.
      let wasAddressed = false
      const syncAddressJump = (): void => {
        const addressed = ctx.sessions.list.getSnapshot().currentAddress !== undefined
        if (addressed && !wasAddressed) ctx.workbench.activate('activity')
        wasAddressed = addressed
      }
      syncAddressJump()
      disposers.push(ctx.sessions.list.subscribe(syncAddressJump))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({
        name: 'deepcreator.workbench.panel', id: 'activity', locale: NS, inject: injected,
        children: { 'deepcreator.conversation.embed': { kind: 'single', scope: 'root' } },
      }, ActivityPanel)))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name: 'deepcreator.workbench.panel-icon', id: 'activity' }, ActivityIcon)))
      disposers.push(ctx.locale.register(NS, { zh, en }))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-activity: atomic provider')
}
