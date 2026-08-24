import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import { SkillsSection } from '../src/client/SkillsSection.tsx'
import { SkillsShortcut } from '../src/client/SkillsShortcut.tsx'

describe('ui-skills apply', () => {
  it('registers the settings section and sidebar shortcut through late-bound slots', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const namespace = {
      list: vi.fn(async () => ({ ok: true as const, value: [] })),
      detail: vi.fn(), setEnabled: vi.fn(), installSkill: vi.fn(), removeSkill: vi.fn(),
    }
    const disposeRemote = vi.fn(async () => undefined)
    const mountRemote = vi.fn(async () => {
      ctx.provide('remote.skill-admin', namespace as never)
      return disposeRemote
    })
    ctx.provide('remote', { 'skill-admin': namespace, $mount: mountRemote } as never)
    ctx.provide('workspaces', {
      list: { getSnapshot: () => ({ items: [], recentWorkspaceId: undefined }) },
      pickDirectory: vi.fn(), openPath: vi.fn(),
    } as never)
    ctx.provide('sessions', { list: { getSnapshot: () => ({ current: undefined }) } } as never)
    const navigation = { open: vi.fn(), close: vi.fn(), commands: { getSnapshot: vi.fn(), subscribe: vi.fn() } }
    ctx.provide('settingsNavigation', navigation)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
        'sidebar.primary.action': { kind: 'list', scope: 'root' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(inject).toEqual(['slots', 'locale', 'remote', 'workspaces', 'sessions', 'settingsNavigation'])
    expect(mountRemote).toHaveBeenCalledOnce()
    expect(slots.entries('settings.section')[0]).toMatchObject({ component: SkillsSection, options: { id: 'skills', order: 50 } })
    expect(slots.entries('sidebar.primary.action')[0]).toMatchObject({ component: SkillsShortcut, options: { id: 'skills', order: 10 } })
    const shortcut = (slots.entries('sidebar.primary.action')[0]!.inject as () => { open: () => void })()
    shortcut.open()
    expect(navigation.open).toHaveBeenCalledWith('skills')
    const section = (slots.entries('settings.section')[0]!.inject as () => {
      description: (item: { description: string; localizedDescriptions?: { zh: string; en: string } }) => string
    })()
    const localized = { description: 'English description', localizedDescriptions: { zh: '中文描述', en: 'English description' } }
    expect(section.description(localized)).toBe('中文描述')
    ctx.locale.setLocale('en')
    expect(section.description(localized)).toBe('English description')
    await fiber.dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(slots.entries('settings.section')).toEqual([])
    expect(slots.entries('sidebar.primary.action')).toEqual([])
  })
})
