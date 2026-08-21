// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { RenderModePreference } from '../src/client/chat/render-mode-preference.ts'
import { DEFAULT_RENDER_MODE, type ConversationSettings } from '../src/submission-settings.ts'

describe('RenderModePreference', () => {
  it('starts on Classic and publishes a process-local change', () => {
    const preference = new RenderModePreference()
    const changed = vi.fn()
    preference.value.subscribe(changed)
    expect(preference.value.getSnapshot()).toBe(DEFAULT_RENDER_MODE)
    preference.set('think')
    expect(preference.value.getSnapshot()).toBe('think')
    expect(changed).toHaveBeenCalledOnce()
  })

  it('writes after publishing and adopts Host changes without echoing them', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const preference = new RenderModePreference(host.scope)
    preference.set('normal')
    expect(host.set).toHaveBeenCalledWith('defaultRenderMode', 'normal')
    host.set.mockClear()
    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue', defaultRenderMode: 'think' },
      revision: 1,
      writable: true,
    })
    expect(preference.value.getSnapshot()).toBe('think')
    expect(host.set).not.toHaveBeenCalled()
  })

  it('applies a Settings selection to the mounted current session', () => {
    const preference = new RenderModePreference()
    const write = vi.fn()
    const sessionId = 'current' as SessionId
    const dispose = preference.bindSession(sessionId, write)
    preference.set('think', sessionId)
    expect(write).toHaveBeenCalledWith('think')
    dispose()
    preference.set('classic', sessionId)
    expect(write).toHaveBeenCalledOnce()
  })

  it('keeps every mounted surface for one session bound independently', () => {
    const preference = new RenderModePreference()
    const mainWrite = vi.fn()
    const activityWrite = vi.fn()
    const sessionId = 'shared' as SessionId
    const disposeMain = preference.bindSession(sessionId, mainWrite)
    const disposeActivity = preference.bindSession(sessionId, activityWrite)

    preference.set('think', sessionId)
    expect(mainWrite).toHaveBeenCalledWith('think')
    expect(activityWrite).toHaveBeenCalledWith('think')

    disposeActivity()
    preference.set('classic', sessionId)
    expect(mainWrite).toHaveBeenLastCalledWith('classic')
    expect(activityWrite).toHaveBeenCalledOnce()
    disposeMain()
  })

  it('reference-counts the same stable writer across two surfaces', () => {
    const preference = new RenderModePreference()
    const write = vi.fn()
    const sessionId = 'shared' as SessionId
    const disposeMain = preference.bindSession(sessionId, write)
    const disposeActivity = preference.bindSession(sessionId, write)

    disposeActivity()
    preference.set('think', sessionId)
    expect(write).toHaveBeenCalledOnce()

    disposeMain()
    preference.set('classic', sessionId)
    expect(write).toHaveBeenCalledOnce()
  })

  it('mirrors a conversation control selection back to Settings', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const preference = new RenderModePreference(host.scope)
    const write = vi.fn()
    const sessionId = 'current' as SessionId
    preference.select(sessionId, 'think', write)
    expect(write).toHaveBeenCalledWith('think')
    expect(preference.value.getSnapshot()).toBe('think')
    expect(host.set).toHaveBeenCalledWith('defaultRenderMode', 'think')
  })

  it('keeps plugin-defined modes session-scoped when they are not a preference option', () => {
    const preference = new RenderModePreference()
    const write = vi.fn()
    preference.select('current' as SessionId, 'plugin-mode', write)
    expect(write).toHaveBeenCalledWith('plugin-mode')
    expect(preference.value.getSnapshot()).toBe(DEFAULT_RENDER_MODE)
  })
})
