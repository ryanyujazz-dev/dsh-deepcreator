import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallView } from '@deepseek-ai/dsh-tools/presentation'
import { artifactNodeDefinition } from '../src/client/artifact-node-definition.ts'
import { ArtifactsSnapshotBuilder } from '../src/client/artifacts-snapshot-builder.ts'
import type { ArtifactConversationNode } from '../src/client/artifact-contract.ts'

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

function toolResult(turn: number, callId: string, seq = turn * 10 + 2): SessionEvent {
  return event('tool/result', { turn, callId, message: { content: [{ type: 'text', text: 'done' }], source: { callId } } }, seq, 'append')
}

function diffView(path: string): ToolCallView {
  return { card: 'diff', title: 'Write', diffs: [], locations: [{ path }] } as ToolCallView
}

/** Minimal projection engine mirroring the runtime assembler (state persists across batches). */
function createProjector(): (events: readonly SessionEvent[]) => ArtifactConversationNode[] {
  const states = new Map<string, NodeState>()
  return (events) => {
    const nodes: ArtifactConversationNode[] = []
    for (const one of events) {
      const result = artifactNodeDefinition.match(one)
      if (result === null) continue
      const view = (one as { view?: unknown }).view as ConversationMatch['view']
      const match = {
        id: result.id,
        role: result.role,
        event: one,
        view,
        location: { kind: 'session' },
      } as ConversationMatch
      const previous = states.get(result.id)
      if (previous === undefined) {
        if (result.role !== 'start') continue
        states.set(result.id, artifactNodeDefinition.start(undefined as never, match))
      } else {
        states.set(result.id, artifactNodeDefinition.update({ state: previous } as never, match))
      }
      const node = artifactNodeDefinition.buildViewNode({ state: states.get(result.id)! } as never)
      if (node !== null) nodes.push(node as ArtifactConversationNode)
    }
    return nodes
  }
}

function timeline() {
  return { turnOrder: [], turns: new Map() }
}

/** Attach one diff call view per tool/call in order, then project. */
function projectWithViews(events: readonly SessionEvent[], projector: ReturnType<typeof createProjector>, paths: string[] = []): ArtifactConversationNode[] {
  let callIndex = 0
  const withViews = events.map(one => {
    if (one.type !== 'tool/call') return one
    const path = paths[callIndex++]
    return { ...one, view: path === undefined ? null : { for: 'call', view: diffView(path) } } as unknown as SessionEvent
  })
  return projector(withViews)
}

const writeTurn = (turn: number): SessionEvent[] => [turnStart(turn), toolCall(turn, `w${turn}`), toolResult(turn, `w${turn}`)]

describe('ArtifactsSnapshotBuilder', () => {
  it('folds per-turn nodes into one record per path, newest first', () => {
    const nodes = projectWithViews([...writeTurn(1), ...writeTurn(2)], createProjector(), ['E:/repo/a.md', 'E:/repo/b.md'])
    const snapshot = new ArtifactsSnapshotBuilder().replace({ nodes, timeline: timeline() })
    expect(snapshot.records.map(item => item.path)).toEqual(['E:/repo/b.md', 'E:/repo/a.md'])
    expect(snapshot.records[0]).toMatchObject({ updatedAt: 2_200, turn: 2 })
    expect(snapshot.records[1]).toMatchObject({ updatedAt: 1_200, turn: 1 })
  })

  it('keeps the latest production of a repeated path', () => {
    const nodes = projectWithViews([...writeTurn(1), ...writeTurn(2)], createProjector(), ['E:/repo/a.md', 'E:/repo/a.md'])
    const snapshot = new ArtifactsSnapshotBuilder().replace({ nodes, timeline: timeline() })
    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.records[0]).toMatchObject({ path: 'E:/repo/a.md', updatedAt: 2_200, turn: 2 })
  })

  it('is deterministic across replays and incremental applies', () => {
    const first = writeTurn(1)
    const followUp = writeTurn(2)
    const full = new ArtifactsSnapshotBuilder().replace({
      nodes: projectWithViews([...first, ...followUp], createProjector(), ['E:/repo/a.md', 'E:/repo/b.md']),
      timeline: timeline(),
    })
    const replayed = new ArtifactsSnapshotBuilder().replace({
      nodes: projectWithViews([...first, ...followUp], createProjector(), ['E:/repo/a.md', 'E:/repo/b.md']),
      timeline: timeline(),
    })
    expect(replayed).toEqual(full)

    const incrementalProjector = createProjector()
    const builder = new ArtifactsSnapshotBuilder()
    builder.replace({ nodes: projectWithViews(first, incrementalProjector, ['E:/repo/a.md']), timeline: timeline() })
    const incremental = builder.apply({
      upserts: projectWithViews(followUp, incrementalProjector, ['E:/repo/b.md']),
      timeline: timeline(),
    })
    expect(incremental).toEqual(full)
  })

  it('clears records on replace', () => {
    const builder = new ArtifactsSnapshotBuilder()
    builder.replace({ nodes: projectWithViews(writeTurn(1), createProjector(), ['E:/repo/a.md']), timeline: timeline() })
    const snapshot = builder.replace({ nodes: [], timeline: timeline() })
    expect(snapshot.records).toEqual([])
  })

  it('keeps truncated windows inert: a turn without its start never materializes', () => {
    const snapshot = new ArtifactsSnapshotBuilder().replace({
      nodes: createProjector()([
        toolCall(1, 'w1'), toolResult(1, 'w1'),
        ...writeTurn(2),
      ]),
      timeline: timeline(),
    })
    // Turn 1's start lives in an unloaded older page: only turn 2 could
    // materialize, and its diff view is absent in this raw projection.
    expect(snapshot.records.map(item => item.path)).toEqual([])
  })
})
