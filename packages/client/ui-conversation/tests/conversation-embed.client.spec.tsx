// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, useContext } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ScopedStandardSourceBinding } from '@deepseek-ai/dsh-client-ui-slots'
import {
  createSessionLeaseHub, type ObservationLeaseSessions, type SessionLeaseHub,
} from '@ryanyujazz/dsh-client-compat'
import { ConversationEmbed, ConversationEmbedSurface } from '../src/client/chat/ConversationEmbed.tsx'
import type {
  ConversationEmbedProps, ConversationEmbedSurfaceProps,
} from '../src/client/chat/ConversationEmbed.tsx'
import { ConversationSurfaceRegistry } from '../src/client/surface-registry.ts'

afterEach(cleanup)

const childId = 'child-session' as SessionId
const embedCss = readFileSync(resolve('packages/client/ui-conversation/src/client/chat/ConversationEmbed.module.css'), 'utf8')
const chatCss = readFileSync(resolve('packages/client/ui-conversation/src/client/chat/ChatView.module.css'), 'utf8')

const flushMicrotasks = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

/** A sessions double recording every lease-relevant call; binding/open/deactivate optional. */
function makeSessionsDouble(): ObservationLeaseSessions & {
  retained: SessionId[]
  released: SessionId[]
  addressed: SessionId[]
  opened: SessionId[]
  deactivated: SessionId[]
  drop(id: SessionId): void
} {
  const sessions = new Map<SessionId, { open: () => Promise<void>; deactivate: () => void }>()
  const record = {
    retained: [] as SessionId[],
    released: [] as SessionId[],
    addressed: [] as SessionId[],
    opened: [] as SessionId[],
    deactivated: [] as SessionId[],
    drop(id: SessionId): void {
      sessions.delete(id)
    },
  }
  const double: ObservationLeaseSessions = {
    retainObservation: (id) => { record.retained.push(id) },
    releaseObservation: (id) => { record.released.push(id) },
    retainNavigationAddress: (id) => { record.addressed.push(id) },
    binding: (id) => {
      const session = sessions.get(id)
      if (session === undefined) {
        const created = {
          open: () => { record.opened.push(id); return Promise.resolve() },
          deactivate: () => { record.deactivated.push(id) },
        }
        sessions.set(id, created)
        return { session: created }
      }
      return { session }
    },
  }
  return { ...record, ...double }
}

/** Drive a hub to the cooled state for one id (subscribe, unsubscribe, flush). */
async function leaseOnce(hub: SessionLeaseHub, id: SessionId): Promise<void> {
  const dispose = hub.lease(id).subscribe(() => {})
  dispose()
  await flushMicrotasks()
}

describe('observation lease hub', () => {
  it('acquires on first subscribe, keeps the current selection alone, and cools on last unsubscribe', async () => {
    const sessions = makeSessionsDouble()
    const hub = createSessionLeaseHub(sessions)

    const source = hub.lease(childId)
    expect(hub.lease(childId)).toBe(source)
    expect(source.getSnapshot()).toEqual({ leased: false })

    const dispose = source.subscribe(() => {})
    expect(source.getSnapshot()).toEqual({ leased: true })
    expect(sessions.retained).toEqual([childId])
    expect(sessions.addressed).toEqual([childId])
    expect(sessions.opened).toEqual([childId])

    dispose()
    // StrictMode-safe: the release waits one microtask for a re-subscribe.
    expect(source.getSnapshot()).toEqual({ leased: true })
    expect(sessions.deactivated).toEqual([])
    await flushMicrotasks()
    expect(source.getSnapshot()).toEqual({ leased: false })
    expect(sessions.deactivated).toEqual([childId])
    // Cooling keeps the eligibility hold: not released yet.
    expect(sessions.released).toEqual([])
  })

  it('re-acquiring within the release tick cancels the cooldown teardown', async () => {
    const sessions = makeSessionsDouble()
    const hub = createSessionLeaseHub(sessions)

    const dispose = hub.lease(childId).subscribe(() => {})
    dispose()
    const disposeAgain = hub.lease(childId).subscribe(() => {})
    await flushMicrotasks()
    expect(sessions.deactivated).toEqual([])

    disposeAgain()
    await flushMicrotasks()
    expect(sessions.deactivated).toEqual([childId])
  })

  it('evicts the coldest cooled session beyond the MRU retention window', async () => {
    const sessions = makeSessionsDouble()
    const hub = createSessionLeaseHub(sessions)
    const ids = Array.from({ length: 9 }, (_, i) => `cold-${i}` as SessionId)

    for (const id of ids) await leaseOnce(hub, id)

    // 8 most-recent stays observation-retained; the coldest loses its hold.
    expect(sessions.released).toEqual([ids[0]])
    expect(sessions.retained.filter((id) => id === ids[0])).toHaveLength(1)
    for (const id of ids.slice(1)) expect(sessions.released).not.toContain(id)
  })
})

describe('explicit child transcript surface', () => {
  it('overrides the scope binding with the child binding without changing navigation', () => {
    const sessions = makeSessionsDouble()
    const hub = createSessionLeaseHub(sessions)
    const binding = { key: childId } as unknown as ScopedStandardSourceBinding
    const scopeContext = createContext<ScopedStandardSourceBinding | null>(null)
    // The probe is a real component so its context read happens INSIDE the
    // overridden provider (as the strict surface's entries would).
    const Probe = () => {
      const bound = useContext(scopeContext)
      return <div data-testid="probe">{bound === null ? 'unbound' : `bound:${String(bound.key)}`}</div>
    }
    const renderSlot = vi.fn(() => <Probe />)
    const props = {
      childSessionId: childId,
      leaseSession: (id: SessionId) => hub.lease(id),
      resolveSessionBinding: (id: SessionId) => (id === childId ? binding : undefined),
      scopeContext,
      renderSlot,
    } as unknown as ConversationEmbedProps

    render(<ConversationEmbed {...props} />)

    // The child's standard binding reached the strict surface through the
    // overridden scope context, and the lease was acquired for exactly it.
    expect(screen.getByTestId('probe').textContent).toBe(`bound:${childId}`)
    expect(sessions.retained).toEqual([childId])
    expect(sessions.opened).toEqual([childId])
    expect(renderSlot).toHaveBeenCalledExactlyOnceWith(
      'deepcreator.conversation.embed.surface',
      { surfaceId: `activity:${childId}` },
    )
  })

  it('renders nothing while the child binding is unresolvable, and unmounting releases the observation', async () => {
    const sessions = makeSessionsDouble()
    const hub = createSessionLeaseHub(sessions)
    const scopeContext = createContext<ScopedStandardSourceBinding | null>(null)
    const props = {
      childSessionId: childId,
      leaseSession: (id: SessionId) => hub.lease(id),
      resolveSessionBinding: () => undefined,
      scopeContext,
      renderSlot: () => null,
    } as unknown as ConversationEmbedProps

    const view = render(<ConversationEmbed {...props} />)
    // No binding (unresolvable child) — the embed renders null instead of
    // addressing the current session.
    expect(view.container.querySelector('[data-transcript-surface]')).toBeNull()

    view.unmount()
    await flushMicrotasks()
    expect(sessions.retained).toEqual([childId])
    expect(sessions.deactivated).toEqual([childId])
  })

  it('invokes the authorized main session renderer in transcript-only form', () => {
    const registry = new ConversationSurfaceRegistry()
    const renderer = vi.fn(({ surfaceId }: { surfaceId: string }) => (
      <div data-testid="shared-transcript">{surfaceId}</div>
    ))
    registry.register(renderer as never)
    const props = {
      sessionId: childId,
      surfaceId: `activity:${childId}`,
      surfaces: registry,
    } as unknown as ConversationEmbedSurfaceProps

    render(<ConversationEmbedSurface {...props} />)

    expect(screen.getByTestId('shared-transcript').textContent).toBe(`activity:${childId}`)
    expect(renderer).toHaveBeenCalledWith({ surfaceId: `activity:${childId}`, transcriptOnly: true })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button', { name: /more|更多/i })).toBeNull()
  })

  it('keeps the shared transcript shrinkable inside a narrow Activity panel', () => {
    expect(embedCss).toMatch(/\.root\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?--dsh-composer-side-clearance:\s*0px;/)
    expect(embedCss).toMatch(/\.body\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/)
    expect(chatCss).toMatch(/\.scroll\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?box-sizing:\s*border-box;/)
    expect(chatCss).toMatch(/\.column\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/)
  })

  it('keeps only the latest authorized root renderer and disposes it StrictMode-safely', () => {
    const registry = new ConversationSurfaceRegistry()
    const first = vi.fn(() => null)
    const second = vi.fn(() => null)
    const disposeFirst = registry.register(first)
    const disposeSecond = registry.register(second)

    disposeFirst()
    expect(registry.getSnapshot()).toBe(second)
    disposeSecond()
    expect(registry.getSnapshot()).toBeUndefined()
  })
})
