import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import { DeepCreatorIconActivity16 } from '@ryanyujazz/dsh-client-ui-primitives'
import type { WorkbenchPanelIconProps } from '@ryanyujazz/dsh-client-ui-workbench/client'
import type {} from '@ryanyujazz/dsh-client-ui-workbench/client'
import { ActivityPanel } from './ActivityPanel.tsx'
import { en, NS, zh, type ActivityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'workbench-activity': ActivityKey } }

function ActivityIcon({ size }: WorkbenchPanelIconProps) { return DeepCreatorIconActivity16({ size }) }

export const inject = ['slots', 'workbench', 'locale']

export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(ctx.workbench.registerType({
        id: 'activity', label: () => t('type'), scope: 'session', supportsHome: true, supportsCreate: false,
        supportsMultipleInstances: false, minWidth: 150, minHeight: 220, preferredWidth: 360, initialWidthRatio: 1 / 3, closePolicy: 'dispose',
      }))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel', () => ctx.slots.register({ name: 'deepcreator.workbench.panel', id: 'activity', locale: NS }, ActivityPanel)))
      disposers.push(ctx.slots.inject('deepcreator.workbench.panel-icon', () => ctx.slots.register({ name: 'deepcreator.workbench.panel-icon', id: 'activity' }, ActivityIcon)))
      disposers.push(ctx.locale.register(NS, { zh, en }))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'ui-workbench-activity: atomic provider')
}
