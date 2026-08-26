/**
 * M4 operation tools: the invoke circuit (five consecutive execution-phase
 * failures open it; a success closes it), the param/action/addressing
 * rejections that never trip the circuit, and the installed-domain data
 * read/write envelopes.
 * @module @ryanyujazz/dsh-app-stage-agent/tests/invoke-tools.spec
 */
import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createAppAssetListTool, createAppAssetWriteTool, createAppDataReadTool, createAppDataWriteTool, createAppInvokeTool, createAppOpenTool, type AppOperationEnvironment } from '../src/tools.ts'

function execWith(): ToolRunContext {
  return {
    agent: { session: { header: { cwd: '/ws/project-a' }, id: 'session-1' } },
  } as unknown as ToolRunContext
}

type InvokeReply =
  | { ok: true; appId: string; version: string; action: string; result?: unknown; persistedKeys: readonly string[] }
  | { ok: false; code: string; message: string; actionApplied?: boolean }

function envWith(invokeReply: () => Promise<InvokeReply>, dataGet?: unknown, dataSet?: unknown): AppOperationEnvironment {
  return {
    appStage: {
      devOriginURL: vi.fn(),
      installedOriginURL: vi.fn(),
      invoke: vi.fn(invokeReply),
      open: vi.fn(async () => ({ ok: true, appId: 'kanban-demo', version: '0.1.0', opened: true, focused: false })),
      dataGet: vi.fn(async () => ({ ok: true, value: null, rev: 3 })),
      dataProbe: vi.fn(dataGet ?? (async () => ({ ok: true, found: true, value: { board: { items: [] } }, rev: 3 }))),
      dataSet: vi.fn(dataSet ?? (async () => ({ ok: true, rev: 4 }))),
      assetWrite: vi.fn(async () => ({ ok: true, appId: 'canvas', name: 'sunset.png', url: '/deepcreator-app-stage/assets/canvas/sunset.png', mediaType: 'image/png', bytes: 1843200, overwritten: false, quotaUsedBytes: 1843200 })),
      assetList: vi.fn(async () => ({ ok: true, appId: 'canvas', assets: [], quotaUsedBytes: 0, quotaLimitBytes: 268435456 })),
    },
  } as unknown as AppOperationEnvironment
}

const envelope = (value: unknown): { error?: { code: string; message: string; actionApplied?: string }; persistedKeys?: readonly string[] } & Record<string, unknown> =>
  value as { error?: { code: string; message: string } } & Record<string, unknown>

const handlerFailed = async (): Promise<InvokeReply> => ({ ok: false, code: 'HANDLER_FAILED', message: 'the app crashed' })
const success = async (): Promise<InvokeReply> => ({ ok: true, appId: 'kanban-demo', version: '0.1.0', action: 'createTask', result: { id: 'n-1' }, persistedKeys: ['board.items'] })

describe('app_invoke circuit (E1: five consecutive failures → CIRCUIT_OPEN)', () => {
  it('opens after five consecutive execution-phase failures', async () => {
    const env = envWith(handlerFailed)
    const tool = createAppInvokeTool(env)
    for (let i = 0; i < 5; i += 1) {
      const result = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith()))
      expect(result.error?.code).toBe('HANDLER_FAILED')
    }
    const sixth = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith()))
    expect(sixth.error?.code).toBe('CIRCUIT_OPEN')
    expect(sixth.error?.message).toContain('app_list')
  })

  it('a success closes the circuit and resets the count', async () => {
    let fail = true
    const env = envWith(async () => (fail ? handlerFailed() : success()))
    const tool = createAppInvokeTool(env)
    await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith())
    fail = false
    const recovered = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith()))
    expect(recovered.error).toBeUndefined()
    fail = true
    for (let i = 0; i < 4; i += 1) await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith())
    const notYetOpen = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith()))
    expect(notYetOpen.error?.code).toBe('HANDLER_FAILED')
  })

  it('validation rejections never trip the circuit', async () => {
    const env = envWith(success)
    const tool = createAppInvokeTool(env)
    for (let i = 0; i < 8; i += 1) {
      const result = envelope(await tool.execute({ appId: 'kanban-demo', action: 'nope', params: {} }, execWith()))
      void result
    }
    const still = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith()))
    expect(still.error).toBeUndefined()
    expect(env.appStage.invoke).toHaveBeenCalledTimes(9)
  })

  it('surfaces actionApplied on timeout with the read-first fix guidance', async () => {
    const env = envWith(async () => ({ ok: false, code: 'INVOKE_TIMEOUT', message: 'the router did not complete within 30000 ms; the command may already have run', actionApplied: true }))
    const tool = createAppInvokeTool(env)
    const result = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: {} }, execWith()))
    expect(result.error?.code).toBe('INVOKE_TIMEOUT')
    expect((result as unknown as { error: { context: { actionApplied?: string } } }).error.context.actionApplied).toBe('true')
  })

  it('rejects an illegal appId or action name locally', async () => {
    const env = envWith(success)
    const tool = createAppInvokeTool(env)
    expect(envelope(await tool.execute({ appId: 'DEV:kanban', action: 'x', params: {} }, execWith())).error?.code).toBe('APP_ID_INVALID')
    expect(envelope(await tool.execute({ appId: 'kanban-demo', action: 'NotCamel', params: {} }, execWith())).error?.code).toBe('ACTION_INVALID')
    expect(env.appStage.invoke).not.toHaveBeenCalled()
  })

  it('returns the version and persistedKeys for skill-pack drift awareness', async () => {
    const env = envWith(success)
    const tool = createAppInvokeTool(env)
    const result = envelope(await tool.execute({ appId: 'kanban-demo', action: 'createTask', params: { title: 'x' } }, execWith()))
    expect(result.appId).toBe('kanban-demo')
    expect(result.version).toBe('0.1.0')
    expect(result.persistedKeys).toEqual(['board.items'])
  })
})

describe('app_open', () => {
  it('delegates to the service with focus flag and returns presentation facts', async () => {
    const env = envWith(success)
    const tool = createAppOpenTool(env)
    const result = envelope(await tool.execute({ appId: 'kanban-demo', focus: true }, execWith()))
    expect(env.appStage.open).toHaveBeenCalledWith(expect.anything(), 'kanban-demo', true)
    expect(result.opened).toBe(true)
    expect(result.focused).toBe(false)
  })
})

describe('app_data_read / app_data_write', () => {
  it('reads with found/value/dataVersion and maps addressing failures', async () => {
    const env = envWith(success)
    const tool = createAppDataReadTool(env)
    const result = envelope(await tool.execute({ appId: 'kanban-demo', path: 'board.items' }, execWith()))
    expect(result.found).toBe(true)
    expect(result.dataVersion).toBe('3')
    expect(env.appStage.dataProbe).toHaveBeenCalledWith(expect.anything(), 'kanban-demo', 'board.items')
  })

  it('rejects illegal paths locally', async () => {
    const env = envWith(success)
    const tool = createAppDataReadTool(env)
    expect(envelope(await tool.execute({ appId: 'kanban-demo', path: 'a..b' }, execWith())).error?.code).toBe('PATH_INVALID')
  })

  it('writes one journaled key path and reports bytes', async () => {
    const env = envWith(success)
    const tool = createAppDataWriteTool(env)
    const result = envelope(await tool.execute({ appId: 'kanban-demo', path: 'board.title', value: '看板' }, execWith()))
    expect(result.dataVersion).toBe('4')
    expect(Number(result.bytes)).toBeGreaterThan(0)
    expect(env.appStage.dataSet).toHaveBeenCalledWith(expect.anything(), 'kanban-demo', 'board.title', '看板', expect.stringMatching(/^agent-/))
  })

  it('maps NOT_FOUND to APP_NOT_INSTALLED on the wire envelope', async () => {
    const env = envWith(success, async () => ({ ok: false, code: 'NOT_FOUND', message: 'No installed app "x".' }))
    const tool = envelope ? createAppDataReadTool(env) : undefined
    const result = envelope(await tool!.execute({ appId: 'ghost-app', path: 'a' }, execWith()))
    expect(result.error?.code).toBe('APP_NOT_INSTALLED')
  })
})

describe('app_asset_write / app_asset_list', () => {
  it('writes through the service and echoes the receipt', async () => {
    const env = envWith(success)
    const tool = createAppAssetWriteTool(env)
    const result = envelope(await tool.execute({ appId: 'canvas', name: 'sunset.png', sourcePath: 'output/images/sunset.png' }, execWith()))
    expect(result.error).toBeUndefined()
    expect(result.url).toBe('/deepcreator-app-stage/assets/canvas/sunset.png')
    expect(env.appStage.assetWrite).toHaveBeenCalledWith(expect.anything(), 'canvas', 'sunset.png', 'output/images/sunset.png')
  })

  it('maps service failures with fix guidance', async () => {
    const env = envWith(success)
    ;(env.appStage as unknown as { assetWrite: ReturnType<typeof vi.fn> }).assetWrite = vi.fn(async () => ({ ok: false, code: 'ASSET_QUOTA_EXCEEDED', message: 'quota' }))
    const tool = createAppAssetWriteTool(env)
    const result = envelope(await tool.execute({ appId: 'canvas', name: 'big.png', sourcePath: 'x.png' }, execWith()))
    expect(result.error?.code).toBe('ASSET_QUOTA_EXCEEDED')
    expect(result.error?.message).toContain('app_asset_list')
  })

  it('validates name and appId locally before the service', async () => {
    const env = envWith(success)
    const tool = createAppAssetWriteTool(env)
    expect(envelope(await tool.execute({ appId: 'canvas', name: 'a b.png', sourcePath: 'x' }, execWith())).error?.code).toBe('NAME_INVALID')
    expect(envelope(await tool.execute({ appId: 'X', name: 'a.png', sourcePath: 'x' }, execWith())).error?.code).toBe('APP_ID_INVALID')
    expect(env.appStage.assetWrite).not.toHaveBeenCalled()
  })

  it('lists assets with quota usage', async () => {
    const env = envWith(success)
    ;(env.appStage as unknown as { assetList: ReturnType<typeof vi.fn> }).assetList = vi.fn(async () => ({
      ok: true, appId: 'canvas',
      assets: [{ name: 'sunset.png', url: '/deepcreator-app-stage/assets/canvas/sunset.png', mediaType: 'image/png', bytes: 1843200, updatedAt: '2025-01-01T09:00:00.000Z' }],
      quotaUsedBytes: 1843200, quotaLimitBytes: 268435456,
    }))
    const tool = createAppAssetListTool(env)
    const result = envelope(await tool.execute({ appId: 'canvas' }, execWith()))
    expect(result.assets).toHaveLength(1)
    expect(result.quotaLimitBytes).toBe(268435456)
  })
})
