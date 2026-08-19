// Embed engine: the official assembler driven over a polled child window —
// same Definitions and chat view builder as the node-definitions spec, so the
// assertions ride the real folding pipeline.

import { describe, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationEventInput,
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { nextStepInboxDefinition, nextTurnInboxDefinition } from '../src/client/conversation-nodes/inbox.ts'
import { messageDefinition } from '../src/client/conversation-nodes/message.ts'
import { ConversationEmbedEngine } from '../src/client/chat/embed-engine.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [nextTurnInboxDefinition, nextStepInboxDefinition, messageDefinition, assistantDefinition]
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function event(seq: number, type: string, data: unknown, surfaceOp?: 'append'): ConversationEventInput['event'] {
  return { seq, time: 1_700_000_000_000 + seq, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } as never
}

function textMessage(id: string, text: string): unknown {
  return { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }
}

function assistantMessage(id: string, text: string): unknown {
  return { message: { id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'x', model: 'x' } } }
}

function userEvent(seq: number, id: string, text: string): ConversationEventInput['event'] {
  return event(seq, 'user/message', textMessage(id, text), 'append')
}

function kinds(engine: ConversationEmbedEngine): string[] {
  const chat = engine.getSnapshot().chat as ChatSnapshot
  return chat.order
    .map(key => chat.nodes.get(key))
    .filter((node): node is ChatConversationViewNode => node !== undefined)
    .map(node => node.kind)
}

describe('ConversationEmbedEngine', () => {
  it('folds a polled window into the chat snapshot and publishes through uSES', () => {
    const engine = new ConversationEmbedEngine(new TestEventDefinitions(), new TestViewDefinitions(), 'child' as never)
    const listener = vi.fn()
    const off = engine.subscribe(listener)

    engine.push([
      event(0, 'turn/start', { turn: 0 }),
      userEvent(1, 'u1', '任务指令'),
      event(2, 'step/start', { turn: 0, step: 0 }),
      event(3, 'assistant/message', { turn: 0, step: 0, ...assistantMessage('a1', '回复') }, 'append'),
      event(4, 'step/end', { turn: 0, step: 0 }),
      event(5, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
    ])
    const snapshot = engine.getSnapshot()
    expect(snapshot.openState).toBe('open')
    expect(snapshot.queue).toEqual([])
    expect(kinds(engine)).toEqual(['user', 'assistant-step'])
    expect(listener).toHaveBeenCalled()

    off()
    engine.push([event(6, 'turn/start', { turn: 1 }), userEvent(7, 'u2', '追加')])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(kinds(engine)).toEqual(['user', 'assistant-step', 'user'])
  })

  it('adopts the catalog activity bit into the synthetic running flag', () => {
    const engine = new ConversationEmbedEngine(new TestEventDefinitions(), new TestViewDefinitions(), 'child' as never)
    expect(engine.getSnapshot().running).toBe(false)
    engine.setRunning(true)
    expect(engine.getSnapshot().running).toBe(true)
    engine.setRunning(true)
    const first = engine.getSnapshot()
    engine.setRunning(false)
    expect(engine.getSnapshot().running).toBe(false)
    expect(first.running).toBe(true)
  })

  it('serves an exact empty snapshot before any window lands', () => {
    const engine = new ConversationEmbedEngine(new TestEventDefinitions(), new TestViewDefinitions(), 'child' as never)
    const snapshot = engine.getSnapshot()
    expect(snapshot.chat.order).toEqual([])
    expect(snapshot.partial).toBe(null)
    expect(snapshot.nodes).toEqual([])
  })
})
