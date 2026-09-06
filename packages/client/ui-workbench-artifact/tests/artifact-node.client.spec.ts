import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  type ConversationMatch,
  type ConversationNodeContext,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { artifactNodeDefinition, producedForClosing } from '../src/client/artifact-node-definition.ts'

type NodeState = ReturnType<typeof artifactNodeDefinition.start>

function event(type: string, data: unknown, seq: number, surfaceOp?: string): SessionEvent {
  return { seq, time: seq * 100, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } as unknown as SessionEvent
}

function turnStart(turn: number, seq = turn * 10): SessionEvent {
  return event('turn/start', { turn }, seq)
}

/** The 0.1.2 wire call carries the tool name and model-produced JSON arguments. */
function toolCall(turn: number, callId: string, seq = turn * 10 + 1, name = 'write', args = '{"file_path":"E:/repo/x.md","content":"x"}'): SessionEvent {
  return event('tool/call', { turn, callId, name, arguments: args }, seq)
}

function toolResult(turn: number, callId: string, seq = turn * 10 + 2, isError = false): SessionEvent {
  return event('tool/result', {
    turn,
    callId,
    message: {
      content: [{ type: 'text', text: 'done', ...(isError ? { isError: true } : {}) }],
      source: { callId },
    },
  }, seq, 'append')
}

/** The engine wraps each match result with the raw event. */
function matchOf(one: SessionEvent): ConversationMatch {
  const turn = (one.data as { turn?: number }).turn
  if (turn === undefined) throw new Error('test event has no turn')
  return {
    id: String(turn),
    role: one.type === 'turn/start' ? 'start' : 'update',
    event: one,
    location: { kind: 'session' },
  } as ConversationMatch
}

function contextFor(state: NodeState | undefined, id = '1'): ConversationNodeContext<NodeState> {
  return {
    key: `workbench-artifact:${id}`, kind: 'workbench-artifact', id,
    matches: [], start: undefined, state, current: new Map(),
  } as ConversationNodeContext<NodeState>
}

describe('artifactNodeDefinition', () => {
  it('routes turn events only: turn/start starts, tool events update, others are null', () => {
    expect(artifactNodeDefinition.match(turnStart(1))).toEqual({ id: '1', role: 'start' })
    expect(artifactNodeDefinition.match(toolCall(1, 'c1'))).toEqual({ id: '1', role: 'update' })
    expect(artifactNodeDefinition.match(toolResult(1, 'c1'))).toEqual({ id: '1', role: 'update' })
    expect(artifactNodeDefinition.match(event('user/message', { text: 'no' }, 99))).toBeNull()
    expect(artifactNodeDefinition.match(event('assistant/chunk', { text: 'no' }, 100))).toBeNull()
    // A replacement-surface tool/result (compaction) is not a production fact.
    expect(artifactNodeDefinition.match(event('tool/result', { turn: 1, callId: 'c1', message: { content: [], source: { callId: 'c1' } } }, 101, 'replace'))).toBeNull()
  })

  it('declares identity and target once for the whole definition', () => {
    expect(artifactNodeDefinition.kind).toBe('workbench-artifact')
    expect(artifactNodeDefinition.target).toBe('artifacts')
  })

  it('collects produced paths from write and edit wire calls', () => {
    let current = artifactNodeDefinition.start(contextFor(undefined), matchOf(turnStart(1)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'write', 11, 'write', '{"file_path":"E:/repo/a.md","content":"x"}')))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'edit', 12, 'edit', '{"file_path":"E:/repo/b.md","old_string":"a","new_string":"b"}')))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'write', 13)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'edit', 14)))

    expect(current.produced.map(item => item.path)).toEqual(['E:/repo/a.md', 'E:/repo/b.md'])
    expect(current.produced.map(item => item.seq)).toEqual([13, 14])
  })

  it('selects only this turn\'s paths settled by the closing seq and deduplicates first-seen order', () => {
    expect(producedForClosing({
      kind: 'turn', turn: 2, produced: [
        { path: 'a.md', seq: 10, time: 100 },
        { path: 'b.ts', seq: 12, time: 120 },
        { path: 'a.md', seq: 14, time: 140 },
      ],
    }, 12)).toEqual(['a.md', 'b.ts'])
  })

  it('ignores non-mutation calls, failed results and unknown call ids', () => {
    let current = artifactNodeDefinition.start(contextFor(undefined), matchOf(turnStart(1)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'term', 11, 'bash', '{"command":"ls"}')))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'read', 12, 'read', '{"file_path":"E:/repo/a.md"}')))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'failed', 13, 'write', '{"file_path":"E:/repo/c.md","content":"x"}')))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'term', 14)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'ghost', 15)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'failed', 16, true)))

    expect(current.produced).toEqual([])
  })

  it('builds turn nodes with produced paths and anchor seq, null before materialization', () => {
    let current = artifactNodeDefinition.start(contextFor(undefined, '2'), matchOf(turnStart(2, 20)))
    current = artifactNodeDefinition.update(contextFor(current, '2'), matchOf(toolCall(2, 'write', 21, 'write', '{"file_path":"E:/repo/c.md","content":"x"}')))
    current = artifactNodeDefinition.update(contextFor(current, '2'), matchOf(toolResult(2, 'write', 22)))
    const node = artifactNodeDefinition.buildViewNode(contextFor(current, '2'))
    expect(node).toMatchObject({
      key: 'workbench-artifact:2',
      kind: 'workbench-artifact',
      id: '2',
      target: 'artifacts',
      anchorSeq: 22,
      data: { kind: 'turn', turn: 2, produced: [{ path: 'E:/repo/c.md', seq: 22 }] },
    })
    expect(artifactNodeDefinition.buildViewNode(contextFor(undefined))).toBeNull()
  })
})
