import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ToolArgsError, assertSupportedJsonSchema, type JsonSchemaNode, type JsonValue, type ToolDefinition,
  type ToolRunContext, validateJsonSchemaValue, valueSchemaSpecToJsonSchema,
} from '@deepseek-ai/dsh-tools'
import type { PresentationRuntime } from './runtime.ts'
import { presentationSignal } from './types.ts'

const outputSchema: JsonSchemaNode = {
  type: 'object', additionalProperties: false,
  properties: {
    requestId: { type: 'string' },
    resource: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string' }, id: { type: 'string' } }, required: ['kind', 'id'] },
    status: { type: 'string', enum: ['presented', 'suppressed', 'unavailable'] },
    presenterId: { type: 'string' },
    failure: {
      type: 'object', additionalProperties: false,
      properties: {
        code: { type: 'string', enum: ['NO_CAPABLE_CLIENT', 'NO_PRESENTER', 'PANEL_UNAVAILABLE', 'PANEL_RENDER_TIMEOUT', 'SURFACE_BRIDGE_UNAVAILABLE', 'SURFACE_MOUNT_REJECTED', 'SURFACE_MOUNT_TIMEOUT', 'SURFACE_DESTROYED', 'PRESENTER_ERROR', 'RECEIPT_TIMEOUT', 'CLIENT_DISCONNECTED', 'RESOLVER_UNAVAILABLE', 'MATERIALIZATION_FAILED'] },
        stage: { type: 'string', enum: ['resolve', 'materialize', 'claim', 'present', 'mount', 'acknowledge'] },
        retryable: { type: 'boolean' }, message: { type: 'string' },
      }, required: ['code', 'stage', 'retryable', 'message'],
    },
  }, required: ['requestId', 'status'],
}

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue }
function owner(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('open_in_deepcreator requires an owning Agent session.')
  return exec.agent
}
function cwd(agent: Agent): string { return agent.session.header.cwd ?? process.cwd() }

export interface PresentationToolEnvironment { runtime: PresentationRuntime; turnOf(agent: Agent): number }

/** Build after resolver contributions load, so Native and Code Mode receive the same exact-one resource schema. */
export function createOpenInDeepCreatorTool(env: PresentationToolEnvironment): ToolDefinition {
  const resolvers = env.runtime.resolvers()
  const branches = resolvers.map(resolver => valueSchemaSpecToJsonSchema(resolver.inputSchema))
  const inputSchema: JsonSchemaNode = branches.length >= 2 ? { oneOf: branches } : (branches[0] ?? { type: 'object', properties: {}, additionalProperties: false })
  const parameters: JsonSchemaNode = { type: 'object', additionalProperties: false, properties: { input: inputSchema }, required: ['input'] }
  assertSupportedJsonSchema(parameters)
  assertSupportedJsonSchema(outputSchema)
  const descriptions = resolvers.map(resolver => `${resolver.kind}: ${resolver.description}`).join(' ')
  return {
    name: 'open_in_deepcreator',
    description: `Create or present exactly one resource in the active DeepCreator client by passing its variant under input. The result distinguishes resource materialization from actual user-visible presentation. Only status="presented" proves presentation; never infer success from materialization, a panel shell, or Browser loading. Do not claim success when status is unavailable. Do not retry when failure.retryable is false: stable failures for the same input are suppressed for the rest of the current turn. Retry a retryable failure only after its stated client condition changed. ${descriptions}`,
    parameters: parameters as ToolDefinition['parameters'],
    output: { schema: outputSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const violations = validateJsonSchemaValue(parameters, args, '$')
      if (violations.length > 0) throw new ToolArgsError(violations)
      const agent = owner(exec)
      const input = env.runtime.parse((args as { input: unknown }).input)
      return json(await env.runtime.open({ sessionId: String(agent.id), turn: env.turnOf(agent), workspaceRoot: cwd(agent), signal: presentationSignal(exec.signal) }, input))
    },
  }
}
