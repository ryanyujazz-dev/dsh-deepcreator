import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { inspectRequestPrompt } from '../src/client/contract/request-inspection.ts'
import type { SystemPromptNode } from '../src/client/contract/request-inspection.ts'

const CONFIG = { provider: 'test', model: 'test' }

function systemNode(seq: SessionSeq, text: string): SystemPromptNode {
  return { seq, time: 1_700_000_000_000 + seq, turn: 1, step: 1, text, update: false }
}

function header(
  seq: SessionSeq,
  reason: SessionEvent<'request/header'>['data']['reason'],
  value: SessionEvent<'request/header'>['data']['header'],
): SessionEvent<'request/header'> {
  return {
    type: 'request/header',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { reason, header: value },
  }
}

describe('inspectRequestPrompt', () => {
  it('classifies the first complete header as the initial prompt', () => {
    expect(inspectRequestPrompt(undefined, header(SessionSeq(1), 'initial', {
      config: CONFIG,
      tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }],
    }), systemNode(SessionSeq(1), '# System\n\nFollow instructions.'))).toMatchObject({
      prompt: {
        config: CONFIG,
        system: '# System\n\nFollow instructions.',
        tools: [{ name: 'read' }],
      },
      change: { seq: 1, time: 1_700_000_000_001, kind: 'initial' },
    })
  })

  it('suppresses a resume header when the earlier prompt is outside the loaded window', () => {
    expect(inspectRequestPrompt(undefined, header(SessionSeq(2), 'resume', {
      config: CONFIG,
    }), systemNode(SessionSeq(2), 'same prompt'))).toEqual({
      prompt: { config: CONFIG, system: 'same prompt', tools: [] },
    })
  })

  it('classifies system, tool, and combined changes against the previous prompt', () => {
    const initial = inspectRequestPrompt(undefined, header(SessionSeq(1), 'initial', {
      config: CONFIG,
      tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
    }), systemNode(SessionSeq(1), 'first')).prompt
    const system = inspectRequestPrompt(initial, header(SessionSeq(2), 'change', {
      config: CONFIG,
      tools: [...initial.tools],
    }), systemNode(SessionSeq(2), 'second'))
    const tools = inspectRequestPrompt(system.prompt, header(SessionSeq(3), 'change', {
      config: CONFIG,
      tools: [{ name: 'write', description: 'Write', parameters: { type: 'object' } }],
    }), systemNode(SessionSeq(3), 'second'))
    const combined = inspectRequestPrompt(tools.prompt, header(SessionSeq(4), 'change', {
      config: CONFIG,
      tools: [],
    }), systemNode(SessionSeq(4), 'third'))

    expect(system.change?.kind).toBe('system')
    expect(tools.change?.kind).toBe('tools')
    expect(combined.change?.kind).toBe('system-and-tools')
    expect(combined.change?.previous).toBe(tools.prompt)
  })

  it('omits a change when the prompt and tools are unchanged', () => {
    const previous = inspectRequestPrompt(undefined, header(SessionSeq(1), 'initial', {
      config: CONFIG,
    }), systemNode(SessionSeq(1), 'same')).prompt

    expect(inspectRequestPrompt(previous, header(SessionSeq(2), 'resume', {
      config: { ...CONFIG, maxTokens: 1_024 },
    }), systemNode(SessionSeq(2), 'same'))).toEqual({
      prompt: { config: { ...CONFIG, maxTokens: 1_024 }, system: 'same', tools: [] },
    })
  })
})
