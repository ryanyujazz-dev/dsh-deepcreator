import { describe, expect, it } from 'vitest'
import { TYPERT } from '../lib/typert.host.js'

interface GeneratedInvocation {
  id: string
  result: { schema: { safeParse(value: unknown): { success: boolean; error?: unknown } } }
}

describe('Browser generated Remote boundary', () => {
  it('accepts provider-contributed namespaced capabilities in browser/state', () => {
    const invocation = (TYPERT as { invocations: GeneratedInvocation[] }).invocations.find(item => item.id.endsWith('#browser/state'))
    expect(invocation).toBeDefined()

    const parsed = invocation!.result.schema.safeParse({
      ok: true,
      value: {
        sessionId: 'agent-1',
        revision: 3,
        browsers: [{
          browserId: 'playwright-chromium',
          name: 'Managed Chromium',
          providerKind: 'managed',
          family: 'chromium',
          profile: 'managed-persistent',
          capabilities: ['core.tabs', 'automation.playwright', 'management.install'],
          presentation: { owner: 'none', mode: 'snapshot', requiredBeforeControl: false },
          availability: 'available',
        }],
        tabs: [],
      },
    })

    expect(parsed.success, parsed.success ? undefined : String(parsed.error)).toBe(true)
  })
})
