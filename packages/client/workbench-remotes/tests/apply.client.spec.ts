import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

describe('Workbench Remote BFF', () => {
  it('mounts five generated contributions and disposes them in reverse order', async () => {
    const order: string[] = []
    const mount = vi.fn(async (contribution: { package: string }) => {
      order.push(`mount:${contribution.package}`)
      return async () => { order.push(`dispose:${contribution.package}`) }
    })
    const dispose = await apply({ remote: { $mount: mount } } as unknown as Context)
    expect(mount).toHaveBeenCalledTimes(5)
    await dispose()
    expect(order.slice(5)).toEqual([
      'dispose:@ryanyujazz/dsh-terminal-workbench',
      'dispose:@ryanyujazz/dsh-session-admin',
      'dispose:@ryanyujazz/dsh-review',
      'dispose:@ryanyujazz/dsh-jobs-admin',
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
})
