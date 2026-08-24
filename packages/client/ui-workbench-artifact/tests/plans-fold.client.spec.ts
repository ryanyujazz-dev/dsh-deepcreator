import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch } from '@deepseek-ai/dsh-client-runtime/client'
import { planNodeDefinition } from '../src/client/plan-node-definition.ts'
import { PlansSnapshotBuilder } from '../src/client/plans-snapshot-builder.ts'
import type { PlanConversationNode } from '../src/client/artifact-contract.ts'

type NodeState = ReturnType<typeof planNodeDefinition.start>

function event(type: string, data: unknown, seq: number, surfaceOp?: string): SessionEvent {
  return { seq, time: seq * 100, type, data, ...(surfaceOp === undefined ? {} : { surfaceOp }) } as unknown as SessionEvent
}

function call(turn: number, callId: string, plan: string, seq: number): SessionEvent {
  return event('tool/call', { turn, step: 1, callId, name: 'exit_plan_mode', arguments: JSON.stringify({ plan }) }, seq)
}

function result(turn: number, callId: string, isError: boolean, seq: number): SessionEvent {
  return event('tool/result', {
    turn, callId,
    message: { source: { callId }, content: [{ type: 'tool-result', isError, content: [] }] },
  }, seq, 'append')
}

function project(events: readonly SessionEvent[]): PlanConversationNode[] {
  const states = new Map<string, NodeState>()
  const nodes: PlanConversationNode[] = []
  for (const one of events) {
    const found = planNodeDefinition.match(one)
    if (found === null) continue
    const match = { ...found, event: one, view: undefined, location: { kind: 'session' } } as ConversationMatch
    const previous = states.get(found.id)
    if (previous === undefined) {
      if (found.role !== 'start') continue
      states.set(found.id, planNodeDefinition.start(undefined as never, match, undefined as never))
    } else {
      states.set(found.id, planNodeDefinition.update({ state: previous } as never, match))
    }
    const node = planNodeDefinition.buildViewNode?.({ key: `workbench-plan:${found.id}`, kind: 'workbench-plan', id: found.id, state: states.get(found.id) } as never)
    if (node !== null && node !== undefined) nodes.push(node as PlanConversationNode)
  }
  return nodes
}

const timeline = () => ({ turnOrder: [], turns: new Map() })

describe('current-session plans projection', () => {
  it('keeps every revision newest first and derives pending/approved/rejected status', () => {
    const nodes = project([
      call(1, 'p1', '# First plan\n\n- A', 11), result(1, 'p1', true, 12),
      call(2, 'p2', '# Revised plan\n\n- B', 21), result(2, 'p2', false, 22),
      call(3, 'p3', '# Pending plan', 31),
    ])
    const snapshot = new PlansSnapshotBuilder().replace({ nodes, timeline: timeline() })
    expect(snapshot.records.map(record => [record.callId, record.status])).toEqual([
      ['p3', 'pending'], ['p2', 'approved'], ['p1', 'rejected'],
    ])
    expect(snapshot.records[1]).toMatchObject({ title: 'Revised plan', markdown: '# Revised plan\n\n- B', turn: 2 })
  })

  it('ignores malformed calls, unrelated tools, replacement results, and truncated results', () => {
    const snapshot = new PlansSnapshotBuilder().replace({
      nodes: project([
        event('tool/call', { turn: 1, callId: 'bad', name: 'exit_plan_mode', arguments: '{' }, 1),
        event('tool/call', { turn: 1, callId: 'read', name: 'read', arguments: '{}' }, 2),
        result(1, 'missing', false, 3),
        call(1, 'p1', '# Kept pending', 4),
        { ...result(1, 'p1', false, 5), surfaceOp: 'replace' } as SessionEvent,
      ]),
      timeline: timeline(),
    })
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({ callId: 'p1', status: 'pending' })
  })
})
