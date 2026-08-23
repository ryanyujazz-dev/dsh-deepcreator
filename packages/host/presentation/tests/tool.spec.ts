import { describe, expect, it } from 'vitest'
import { PresentationRuntime } from '../src/runtime.ts'
import { createOpenInDeepCreatorTool } from '../src/tool.ts'

describe('open_in_deepcreator contract', () => {
  it('builds an exact-one resource input schema and structured output independently of Browser', () => {
    const runtime = new PresentationRuntime()
    runtime.registerResolver({
      kind: 'artifact', description: 'artifact',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', const: 'artifact', required: true }, artifactId: { type: 'string', required: true },
      } },
      parse: input => input as { kind: 'artifact'; artifactId: string },
      materialize: async (_context, input) => ({ kind: 'artifact', id: input.artifactId }),
    })
    runtime.registerResolver({
      kind: 'review', description: 'review',
      inputSchema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'review', required: true } } },
      parse: input => input as { kind: 'review' }, materialize: async () => ({ kind: 'review', id: 'home' }),
    })
    const tool = createOpenInDeepCreatorTool({ runtime, turnOf: () => 1 })
    const parameters = tool.parameters as { properties: { input: { oneOf: unknown[] } }; additionalProperties: boolean }
    expect(parameters.additionalProperties).toBe(false)
    expect(parameters.properties.input.oneOf).toHaveLength(2)
    expect(tool.output.schema).toMatchObject({ type: 'object', additionalProperties: false, required: ['requestId', 'status'] })
    expect(tool.description).toContain('Do not claim success when status is unavailable')
  })
})
