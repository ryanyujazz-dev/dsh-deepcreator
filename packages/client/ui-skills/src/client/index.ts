import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-ui-settings/client'
import type {} from '@ryanyujazz/dsh-client-ui-sidebar/client'
import { TYPERT_REMOTE as SKILL_ADMIN_REMOTE } from '@ryanyujazz/dsh-skill-admin/remote'
import type { SkillAdminDetail, SkillAdminItem, SkillAdminTarget, SkillInstallKind } from '@ryanyujazz/dsh-skill-admin/types'
import { SkillsSection } from './SkillsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSection.tsx'
import { SkillsShortcut } from './SkillsShortcut.tsx'
import type { SkillsShortcutInjected } from './SkillsShortcut.tsx'
import { en, zh, type SkillsKey } from './locales.ts'

export type { SkillsSectionInjected, SkillsSectionProps } from './SkillsSection.tsx'
export type { SkillsShortcutInjected, SkillsShortcutProps } from './SkillsShortcut.tsx'
export type { SkillsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { skills: SkillsKey }
}

const NS = 'skills'
export const inject = ['slots', 'locale', 'remote', 'workspaces', 'sessions', 'settingsNavigation']

function unwrap<T>(wire: RemoteResult<T>): T {
  if (!wire.ok) throw new Error(`${wire.error.code}: ${wire.error.message}`)
  return wire.value
}

function applyFeature(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skills: dictionaries')
  const remote = (ctx.get('remote') as TypertClientRemote)['skill-admin']
  const target = (): SkillAdminTarget => {
    const sessions = ctx.sessions.list.getSnapshot()
    const workspaces = ctx.workspaces.list.getSnapshot()
    const workspace = sessions.current === undefined
      ? workspaces.items.find(item => item.workspaceId === workspaces.recentWorkspaceId)
      : workspaces.items.find(item => item.sessionIds.includes(sessions.current!))
    return {
      ...(workspace?.path === undefined ? {} : { cwd: workspace.path }),
      ...(sessions.current === undefined ? {} : { sessionId: sessions.current }),
    }
  }
  const sectionInjected = (): SkillsSectionInjected => ({
    list: async (): Promise<SkillAdminItem[]> => unwrap(await remote.list(target())),
    detail: async (name): Promise<SkillAdminDetail> => unwrap(await remote.detail(name, target())),
    setEnabled: async (name, enabled): Promise<void> => { unwrap(await remote.setEnabled(name, enabled, target())) },
    install: async (kind: SkillInstallKind, value): Promise<void> => { unwrap(await remote.installSkill({ kind, value })) },
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    remove: async (name): Promise<void> => { unwrap(await remote.removeSkill(name, target())) },
    openLocation: async (path): Promise<void> => { await ctx.workspaces.openPath(path) },
    openPlugins: () => { ctx.settingsNavigation.open('plugins') },
    description: item => item.localizedDescriptions?.[ctx.locale.getLocale().active] ?? item.description,
  })
  const shortcutInjected = (): SkillsShortcutInjected => ({
    open: () => { ctx.settingsNavigation.open('skills') },
  })
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'skills', order: 50, label: () => t('nav'), locale: NS, inject: sectionInjected,
  }, SkillsSection))
  ctx.slots.inject('sidebar.primary.action', () => ctx.slots.register({
    name: 'sidebar.primary.action', id: 'skills', order: 10, locale: NS, inject: shortcutInjected,
  }, SkillsShortcut))
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  // This feature owns its Remote codec contribution. Mounting it here keeps
  // Skill administration independent from the Workbench Remote bundle. The
  // child fiber grants access to the namespace only after $mount publishes it.
  const disposeRemote = await ctx.remote.$mount(SKILL_ADMIN_REMOTE)
  const featureFiber = ctx.inject(['remote.skill-admin'], ready => { applyFeature(ready as ClientContext) })
  try { await featureFiber }
  catch (error) { await disposeRemote(); throw error }
  return async () => {
    await featureFiber.dispose()
    await disposeRemote()
  }
}
