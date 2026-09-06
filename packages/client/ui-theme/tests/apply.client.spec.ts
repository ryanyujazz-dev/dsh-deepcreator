/** ui-theme apply wiring: service provision, settings dictionaries riding the
 * locale service, declaration-aware Appearance row registration, snapshot
 * projection into the row store, and HMR collapse recovery. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  SlotRegistry,
} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@ryanyujazz/dsh-client-locale/client'
import { TestRemote, usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply as applyOfficialSettings, inject as officialSettingsInject,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, SETTINGS_NS } from '@ryanyujazz/dsh-client-ui-theme/client'
import type { AppearanceRowInjected, ThemeRuntime } from '@ryanyujazz/dsh-client-ui-theme/client'
import { THEME_SETTINGS_NAMESPACE, ThemeSettingsSchema, type ThemeSettings } from '../src/theme-settings.ts'
import { AppearanceRow } from '../src/client/AppearanceRow.tsx'
import type { createAppearanceRowStore } from '../src/client/settings-store.ts'

// The service reads its initial locale from the browser; these specs assert
// the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

const SLOT = 'deepcreator.settings.preferences.item'

async function bench(isLoopback = true, initialPreference: string = 'system', delayInitialRead = false) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  const settings: ThemeSettings = {
    preference: initialPreference as ThemeSettings['preference'], transcriptTextSize: 'standard',
    lightCodeTheme: 'deepcreator-light', darkCodeTheme: 'deepcreator-dark', codeFont: 'system',
  }
  const namespace = () => ({
    ns: THEME_SETTINGS_NAMESPACE,
    schema: ThemeSettingsSchema.toJSON(),
    value: { ...settings },
    applies: 'live' as const,
    secrets: [],
    revision: 0,
  })
  let releaseInitialRead = () => {}
  const initialReadGate = delayInitialRead
    ? new Promise<void>((resolve) => { releaseInitialRead = resolve })
    : Promise.resolve()
  let isInitialRead = true
  const describe = vi.fn(async () => {
    if (isInitialRead) {
      isInitialRead = false
      await initialReadGate
    }
    // The shared mirror reads the whole document view; each bound scope
    // derives its own namespace row from it.
    return {
      ok: true as const,
      value: { writable: true, hasDocument: true, namespaces: [namespace()] },
    }
  })
  const mutate = vi.fn(async (
    ns: string,
    ops: { op: 'set' | 'unset'; path: string[]; value?: string }[],
  ) => {
    for (const op of ops) {
      if (op.op !== 'set') continue
      const field = op.path[0]
      if (field === 'preference') settings.preference = op.value as ThemeSettings['preference']
      if (field === 'transcriptTextSize') settings.transcriptTextSize = op.value as ThemeSettings['transcriptTextSize']
      if (field === 'lightCodeTheme') settings.lightCodeTheme = op.value as ThemeSettings['lightCodeTheme']
      if (field === 'darkCodeTheme') settings.darkCodeTheme = op.value as ThemeSettings['darkCodeTheme']
      if (field === 'codeFont') settings.codeFont = op.value as ThemeSettings['codeFont']
    }
    // A Host commit forwards one invalidation for the touched namespace; the
    // shared mirror re-reads, so a write that lands before the boot read
    // still converges.
    queueMicrotask(() => remote.emit('settings/document-updated', [ns, 1]))
    return { ok: true as const, value: namespace() }
  })
  ctx.provide('connection', { isLoopback } as never)
  // The settings transport: the official mirror and every bound scope ride
  // `remote.settings`; the double also provides the `remote.<name>` service.
  const remote = new TestRemote(ctx, { settings: { describe, mutate } })
  remote.$host.isLoopback = isLoopback
  await ctx.plugin({ inject: [...officialSettingsInject], apply: applyOfficialSettings }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, locale, describe, mutate, remote,
    setHostPreference: (next: string) => { settings.preference = next },
    setHostTranscriptTextSize: (next: string) => { settings.transcriptTextSize = next },
    releaseInitialRead,
  }
}

/** Stand in for the DeepCreator Preferences group: declare its row slot from root. */
function declareItems(slots: SlotRegistry): () => void {
  return slots.register(
    { name: 'root', children: { [SLOT]: { kind: 'list', scope: 'root' } } } as never,
    () => null,
  )
}

/** Mirror the framework's inject choreography: bake a real instance from the
 * declared handle and hand its actions to the entry's inject factory. */
function faceOf(slots: SlotRegistry) {
  const entry = slots.entries(SLOT).find(e => e.component === AppearanceRow)!
  const handle = entry.store as ReturnType<typeof createAppearanceRowStore>
  const instance = handle.create()
  const face = (entry.inject as unknown as (a: typeof instance.actions) => AppearanceRowInjected)(instance.actions)
  return { entry, instance, face }
}

describe('ui-theme apply', () => {
  it('declares the slot and locale services', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
  })

  it('provides the service, registers localized copy, and registers the row (declaration before or after apply)', async () => {
    const before = await bench()
    declareItems(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('偏好')
    before.locale.setLocale('en')
    expect(before.locale.bind(SETTINGS_NS)('appearance.title')).toBe('Preferences')
    const entry = before.slots.entries(SLOT).find(e => e.component === AppearanceRow)!
    expect(entry.options).toMatchObject({ id: 'appearance', order: 10 })
    expect(before.slots.spec(SLOT)).toEqual({ kind: 'list', scope: 'root' })

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
    declareItems(after.slots)
    await Promise.resolve()
    expect(after.slots.entries(SLOT).some(e => e.component === AppearanceRow)).toBe(true)
    expect(after.slots.spec(SLOT)).toEqual({ kind: 'list', scope: 'root' })
  })

  it('projects service snapshots into the row store and routes face writes back', async () => {
    const b = await bench()
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    // An event ahead of any inject hits the unbound-actions arm.
    theme.setTheme('dark')

    const { instance, face } = faceOf(b.slots)
    // The inject-time re-sync sealed the init window: the mirror is current.
    expect(instance.getSnapshot().preference).toBe('dark')
    expect(instance.getSnapshot().transcriptTextSize).toBe('standard')
    // Copy rides the standard locale seat: the entry declares the namespace.
    expect(b.slots.entries(SLOT).find(e => e.component === AppearanceRow)!.locale).toBe(SETTINGS_NS)

    face.setTheme('system')
    expect(theme.getTheme().preference).toBe('system')
    expect(instance.getSnapshot().preference).toBe('system')
    face.setTranscriptTextSize('large')
    expect(theme.getTheme().transcriptTextSize).toBe('large')
    expect(instance.getSnapshot().transcriptTextSize).toBe('large')
    face.setLightCodeTheme('github-light')
    face.setDarkCodeTheme('one-dark')
    face.setCodeFont('jetbrains-mono')
    expect(instance.getSnapshot()).toMatchObject({
      lightCodeTheme: 'github-light', darkCodeTheme: 'one-dark', codeFont: 'jetbrains-mono',
    })
    await vi.waitFor(() => { expect(b.mutate).toHaveBeenCalledTimes(6) })
  })

  it('loads Host settings at boot, refreshes its namespace, and keeps remote browsers process-local', async () => {
    const b = await bench(true, 'dark')
    declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    // The shared mirror re-reads on every forwarded invalidation; an
    // unrelated namespace's refresh must not move the theme.
    b.remote.emit('settings/document-updated', ['unrelated', 0])
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledTimes(2) })
    expect(theme.getTheme().preference).toBe('dark')
    b.setHostPreference('light')
    b.remote.emit('settings/document-updated', [THEME_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('light') })
    b.setHostPreference('dark')
    b.ctx.emit('connection/reset')
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })

    const away = await bench(false)
    declareItems(away.slots)
    await away.ctx.plugin({ inject: [...inject], apply }).await()
    const remoteTheme = away.ctx.get('theme') as ThemeRuntime
    remoteTheme.setTheme('dark')
    await Promise.resolve()
    // A memory-persisted page is fully process-local: the shared mirror and
    // the bound scope skip both reads and writes for memory persistence.
    expect(away.describe).not.toHaveBeenCalled()
    expect(away.mutate).not.toHaveBeenCalled()
  })

  it('activates before a slow initial settings read and converges when it settles', async () => {
    const b = await bench(true, 'dark', true)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    expect(theme.getTheme().preference).toBe('system')
    b.releaseInitialRead()
    await vi.waitFor(() => { expect(theme.getTheme().preference).toBe('dark') })
    await fiber.dispose()
  })

  it('ignores an invalid preference crossing the settings wire', async () => {
    const b = await bench(true, 'sepia')
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const theme = b.ctx.get('theme') as ThemeRuntime
    await vi.waitFor(() => { expect(b.describe).toHaveBeenCalledOnce() })
    expect(theme.getTheme().preference).toBe('system')
  })

  it('recovers after an HMR collapse of the declaring entry (stale disposer must not block)', async () => {
    const b = await bench()
    const host = declareItems(b.slots)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)

    // Collapse: the declarer dies, the cascade removes our entry while the
    // apply closure still holds its (now stale) disposer.
    host()
    expect(b.slots.entries(SLOT)).toHaveLength(0)

    declareItems(b.slots)
    await Promise.resolve()
    expect(b.slots.entries(SLOT).some(e => e.component === AppearanceRow)).toBe(true)
  })

  it('teardown removes the row and the dictionaries; teardown without a declaration is quiet', async () => {
    const b = await bench()
    declareItems(b.slots)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries(SLOT)).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries(SLOT)).toHaveLength(0)
    // The Preferences owner remains mounted; this plugin owns only its row.
    expect(b.slots.spec(SLOT)).toEqual({ kind: 'list', scope: 'root' })
    // Dictionary disposal: translation falls back to the bare key.
    expect(b.locale.bind(SETTINGS_NS)('appearance.title')).toBe('appearance.title')

    // Never-declared bench: the effect disposer's dispose arm stays undefined.
    const quiet = await bench()
    const f2 = quiet.ctx.plugin({ inject: [...inject], apply })
    await f2.await()
    await f2.dispose()
    expect(quiet.slots.entries(SLOT)).toHaveLength(0)
  })
})
