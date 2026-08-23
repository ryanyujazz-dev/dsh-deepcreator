import type { Context } from '@deepseek-ai/cordis'
import { TYPERT_REMOTE as BROWSER_REMOTE } from '@ryanyujazz/dsh-browser/remote'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('Workbench Remote BFF', () => {
  it('mounts seven generated contributions and disposes them in reverse order', async () => {
    const order: string[] = []
    const mount = vi.fn(async (contribution: { package: string }) => {
      order.push(`mount:${contribution.package}`)
      return async () => { order.push(`dispose:${contribution.package}`) }
    })
    const dispose = await apply({ remote: { $mount: mount } } as unknown as Context)
    expect(mount).toHaveBeenCalledTimes(7)
    await dispose()
    expect(order.slice(7)).toEqual([
      'dispose:@ryanyujazz/dsh-terminal-workbench',
      'dispose:@ryanyujazz/dsh-session-admin',
      'dispose:@ryanyujazz/dsh-review',
      'dispose:@ryanyujazz/dsh-jobs-admin',
      'dispose:@ryanyujazz/dsh-presentation',
      'dispose:@ryanyujazz/dsh-browser',
      'dispose:@ryanyujazz/dsh-artifacts',
    ])
  })

  it('rolls back earlier mounts when a later contribution fails', async () => {
    const dispose = vi.fn(async () => undefined)
    let calls = 0
    const mount = async () => { if (++calls === 2) throw new Error('mount failed'); return dispose }
    await expect(apply({ remote: { $mount: mount } } as unknown as Context)).rejects.toThrow('mount failed')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('mounts a Browser Remote codec that accepts provider extension capabilities', () => {
    const descriptor = BROWSER_REMOTE.descriptors.find(item => item.id.endsWith('#browser/state'))
    expect(descriptor).toBeDefined()
    const result = descriptor!.result.schema.safeParse({
      ok: true,
      value: {
        sessionId: 'agent-1', revision: 1, tabs: [],
        browsers: [{
          browserId: 'playwright-chromium', name: 'Managed Chromium', providerKind: 'managed', family: 'chromium', profile: 'managed-persistent',
          capabilities: ['core.tabs', 'management.install'],
          presentation: { owner: 'none', mode: 'snapshot', requiredBeforeControl: false }, availability: 'available',
        }],
      },
    })
    expect(result.success, result.success ? undefined : String(result.error)).toBe(true)
  })

  it('mounts the complete client-owned Browser lifecycle surface', () => {
    const ids = new Set(BROWSER_REMOTE.descriptors.map(item => item.id))
    expect([...ids].some(id => id.endsWith('#browser/newTab'))).toBe(true)
    expect([...ids].some(id => id.endsWith('#browser/navigateTab'))).toBe(true)
    expect([...ids].some(id => id.endsWith('#browser/closeTab'))).toBe(true)
    expect([...ids].some(id => id.endsWith('#browser/snapshotImage'))).toBe(true)
  })
})
