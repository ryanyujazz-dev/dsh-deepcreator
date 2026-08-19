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
import { toolDefinition } from '../src/client/conversation-nodes/tool.ts'
import { ConversationEmbedEngine } from '../src/client/chat/embed-engine.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [nextTurnInboxDefinition, nextStepInboxDefinition, messageDefinition, assistantDefinition, toolDefinition]
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

  it('degrades a repeated full window to its own delta (remount safety)', () => {
    const engine = new ConversationEmbedEngine(new TestEventDefinitions(), new TestViewDefinitions(), 'child' as never)
    const window = [
      event(0, 'turn/start', { turn: 0 }),
      userEvent(1, 'u1', '任务指令'),
      event(2, 'step/start', { turn: 0, step: 0 }),
      event(3, 'assistant/message', { turn: 0, step: 0, ...assistantMessage('a1', '回复') }, 'append'),
      event(4, 'step/end', { turn: 0, step: 0 }),
      event(5, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
    ]
    engine.push(window)
    // A remount's initial pull serves the SAME trailing window again; the
    // engine owns the folded log, so the overlap is a no-op (no duplicates).
    engine.push(window)
    expect(kinds(engine)).toEqual(['user', 'assistant-step'])
    // A window that spans the cursor folds only its newer tail.
    engine.push([window[4]!, event(6, 'turn/start', { turn: 1 }), userEvent(7, 'u2', '追加')])
    expect(kinds(engine)).toEqual(['user', 'assistant-step', 'user'])
  })

  it('carries the tool-drafting phase: partial blocks, then the running tool call', () => {
    // Real shape off a child's durable log: a step streams reasoning, text,
    // then composes a write tool call; the drafting display needs (a) the
    // partial carrying tool-call blocks BEFORE block-end, and (b) the running
    // tool-call node (and runningCalls mirror) BETWEEN tool/call and
    // tool/result — the execution slot's drafting/running header forms.
    const engine = new ConversationEmbedEngine(new TestEventDefinitions(), new TestViewDefinitions(), 'child' as never)
    const chunk = (seq: number, data: unknown): ConversationEventInput['event'] =>
      event(seq, 'assistant/chunk', { turn: 0, step: 0, chunk: data }) as never
    engine.push([
      event(0, 'turn/start', { turn: 0 }),
      userEvent(1, 'u1', '写一篇短文'),
      event(2, 'step/start', { turn: 0, step: 0 }),
      chunk(3, { type: 'block-start', index: 0, blockType: 'reasoning' }),
      chunk(4, { type: 'reasoning-delta', index: 0, text: '构思' }),
      chunk(5, { type: 'block-end', index: 0, block: { kind: 'reasoning', text: '构思' } }),
      chunk(6, { type: 'block-start', index: 1, blockType: 'text' }),
      chunk(7, { type: 'text-delta', index: 1, text: '我先写正文。' }),
    ])
    // Mid-composition: the partial carries the streaming blocks.
    let snapshot = engine.getSnapshot()
    expect(snapshot.partial).not.toBeNull()
    expect(snapshot.partial?.blocks.map(block => block.kind)).toEqual(['other', 'text'])

    engine.push([
      chunk(8, { type: 'block-start', index: 2, blockType: 'tool-call' }),
      chunk(9, { type: 'tool-call-delta', index: 2, id: 'call-1', name: 'write', argumentsDelta: '{"path":"' }),
    ])
    snapshot = engine.getSnapshot()
    // The tool-call block rides the partial — the DraftingToolRow's data.
    const toolBlock = snapshot.partial?.blocks.find(block => block.kind === 'tool-call')
    expect(toolBlock).toMatchObject({ kind: 'tool-call', name: 'write' })

    engine.push([
      chunk(10, { type: 'tool-call-delta', index: 2, id: 'call-1', argumentsDelta: 'a.md","content":"…"}' }),
      chunk(11, { type: 'block-end', index: 2, block: { kind: 'tool-call', callId: 'call-1', name: 'write', arguments: '{"path":"a.md","content":"…"}' } }),
      chunk(12, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }),
      chunk(13, { type: 'finish' }),
      event(14, 'assistant/message', { turn: 0, step: 0, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '我先写正文。' }], source: { kind: 'model', provider: 'x', model: 'x' } }, usage: { inputTokens: 1, outputTokens: 1 } }, 'append'),
      event(15, 'tool/call', { turn: 0, step: 0, callId: 'call-1', name: 'write', arguments: '{"path":"a.md","content":"…"}' }),
    ])
    // Tool executing: the running call is in order and mirrored as runningCalls.
    snapshot = engine.getSnapshot()
    expect(snapshot.partial).toBeNull()
    expect(snapshot.runningCalls.map(call => call.name)).toEqual(['write'])
    const runningNode = kinds(engine).find(kind => kind === 'tool-call')
    expect(runningNode).toBe('tool-call')

    engine.push([
      event(16, 'tool/result', {
        turn: 0, step: 0,
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }], isError: false }],
          role: 'tool',
        },
      }, 'append'),
      event(17, 'step/end', { turn: 0, step: 0 }),
      event(18, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
    ])
    snapshot = engine.getSnapshot()
    expect(snapshot.runningCalls).toEqual([])
    expect(kinds(engine)).toEqual(['user', 'assistant-step', 'tool-call'])
  })
})
