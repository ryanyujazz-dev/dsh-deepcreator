import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView } from '@deepseek-ai/dsh-tools/presentation'
import { artifactNodeDefinition } from '../src/client/artifact-node-definition.ts'

type NodeState = ReturnType<typeof artifactNodeDefinition.start>

function event(type: string, data: unknown, seq: number, surfaceOp?: string): SessionEvent {
  return { seq, time: seq * 100, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } as unknown as SessionEvent
}

function turnStart(turn: number, seq = turn * 10): SessionEvent {
  return event('turn/start', { turn }, seq)
}

function toolCall(turn: number, callId: string, seq = turn * 10 + 1): SessionEvent {
  return event('tool/call', { turn, callId }, seq)
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

/** The engine wraps each match result with the raw event and the call view. */
function matchOf(one: SessionEvent, view?: ConversationMatch['view']): ConversationMatch {
  const turn = (one.data as { turn?: number }).turn
  if (turn === undefined) throw new Error('test event has no turn')
  return {
    id: String(turn),
    role: one.type === 'turn/start' ? 'start' : 'update',
    event: one,
    view,
    location: { kind: 'session' },
  } as ConversationMatch
}

function contextFor(state: NodeState | undefined, id = '1'): ConversationNodeContext<NodeState> {
  return {
    key: `workbench-artifact:${id}`, kind: 'workbench-artifact', id,
    matches: [], start: undefined, state, current: new Map(),
  } as ConversationNodeContext<NodeState>
}

function diffView(path: string): ToolCallView {
  return { card: 'diff', title: 'Write', diffs: [], locations: [{ path }] } as ToolCallView
}

function genericEditView(path: string): ToolCallView {
  return { card: 'generic', title: 'Edit', kind: 'edit', locations: [{ path }] } as ToolCallView
}

function callView(view: ToolCallView) {
  return { for: 'call', view } as const
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

  it('collects produced paths from diff and generic-edit call views', () => {
    let current = artifactNodeDefinition.start(contextFor(undefined), matchOf(turnStart(1)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'write', 11), callView(diffView('E:/repo/a.md'))))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'edit', 12), callView(genericEditView('E:/repo/b.md'))))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'write', 13)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'edit', 14)))

    expect(current.produced.map(item => item.path)).toEqual(['E:/repo/a.md', 'E:/repo/b.md'])
    expect(current.produced.map(item => item.seq)).toEqual([13, 14])
  })

  it('ignores non-mutation views, failed results and unknown call ids', () => {
    let current = artifactNodeDefinition.start(contextFor(undefined), matchOf(turnStart(1)))
    const terminal = { card: 'terminal', title: 'ls' } as ToolCallView
    const read = { card: 'generic', title: 'Read', kind: 'read', locations: [{ path: 'E:/repo/a.md' }] } as ToolCallView
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'term', 11), callView(terminal)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolCall(1, 'read', 12), callView(read)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'term', 13)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'ghost', 14)))
    current = artifactNodeDefinition.update(contextFor(current), matchOf(toolResult(1, 'read', 15, true)))

    expect(current.produced).toEqual([])
  })

  it('builds turn nodes with produced paths and anchor seq, null before materialization', () => {
    let current = artifactNodeDefinition.start(contextFor(undefined, '2'), matchOf(turnStart(2, 20)))
    current = artifactNodeDefinition.update(contextFor(current, '2'), matchOf(toolCall(2, 'write', 21), callView(diffView('E:/repo/c.md'))))
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
