// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { ConversationEmbed, ConversationEmbedSurface } from '../src/client/chat/ConversationEmbed.tsx'
import type {
  ConversationEmbedProps, ConversationEmbedSurfaceProps,
} from '../src/client/chat/ConversationEmbed.tsx'
import { ConversationSurfaceRegistry } from '../src/client/surface-registry.ts'

afterEach(cleanup)

const childId = 'child-session' as SessionId
const embedCss = readFileSync(resolve('packages/client/ui-conversation/src/client/chat/ConversationEmbed.module.css'), 'utf8')
const chatCss = readFileSync(resolve('packages/client/ui-conversation/src/client/chat/ChatView.module.css'), 'utf8')

describe('explicit child transcript surface', () => {
  it('shares one explicit source and leaves the current session unchanged', async () => {
    const runtime = await SlotTestRuntime.create()
    try {
      const parent = await runtime.sessions.add({ id: 'parent' })
      const child = await runtime.sessions.add({ id: childId }, { current: false })
      const source = runtime.sessions.provideInfoFor(child)
      expect(runtime.sessions.provideInfoFor(child)).toBe(source)
      const disposeMain = source.subscribe(() => {})
      const disposeActivity = source.subscribe(() => {})

      expect(source.getSnapshot().sessionId).toBe(child)
      expect(runtime.sessions.list.getSnapshot().current).toBe(parent)
      disposeActivity()
      expect(source.getSnapshot().sessionId).toBe(child)
      disposeMain()
    } finally {
      await runtime.dispose()
    }
  })

  it('addresses SessionProvider without changing navigation and passes only a surface id downstream', () => {
    const provider = vi.fn(({ sessionId, children }: {
      sessionId?: string
      children: (id: string) => ReactNode
    }) => <>{children(sessionId ?? '')}</>)
    const renderSlot = vi.fn(() => null)
    const props = {
      childSessionId: childId,
      SessionProvider: provider,
      renderSlot,
    } as unknown as ConversationEmbedProps

    render(<ConversationEmbed {...props} />)

    expect(provider).toHaveBeenCalled()
    expect(provider.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ sessionId: childId }))
    expect(renderSlot).toHaveBeenCalledExactlyOnceWith(
      'deepcreator.conversation.embed.surface',
      { surfaceId: `activity:${childId}` },
    )
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
