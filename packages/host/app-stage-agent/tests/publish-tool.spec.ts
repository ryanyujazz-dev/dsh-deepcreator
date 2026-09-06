/** `app_publish` approval policy: first/cross-source hang on the ask seam,
 * same-source installs directly, declines count toward the session ban,
 * explicit cancel maps to USER_DECLINED, aborted asks discard the draft. */
import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createAppPublishTool, type AppPublishEnvironment, type AppPublishServiceFace, type AppPublishAskFace } from '../src/tools.ts'

function execWith(): ToolRunContext {
  return {
    agent: { session: { header: { cwd: '/ws/project-a' }, id: 'session-1' } },
  } as unknown as ToolRunContext
}

function service(prepare: unknown, plan = 'first') {
  return {
    preparePublish: vi.fn(prepare),
    commitPublish: vi.fn(async () => ({ ok: true, appId: 'kanban-demo', version: '0.2.0', plan })),
    abortPublish: vi.fn(() => ({ ok: true })),
  } as unknown as AppPublishServiceFace & { preparePublish: ReturnType<typeof vi.fn>; commitPublish: ReturnType<typeof vi.fn>; abortPublish: ReturnType<typeof vi.fn> }
}

function askFace(answer: 'approve' | 'decline' | 'cancel' | 'abort') {
  return vi.fn(async () => {
    if (answer === 'approve') return { answers: [{ id: 'x', selected: ['安装'] }] }
    if (answer === 'decline') return { answers: [{ id: 'x', selected: ['拒绝'] }] }
    const error = new Error('the user cancelled ask_user_question') as Error & { code: string }
    error.code = answer === 'cancel' ? 'ASK_CANCELLED' : 'ASK_ABORTED'
    throw error
  }) as unknown as ReturnType<typeof vi.fn> & AppPublishAskFace
}

const prepareOK = (plan: string) => vi.fn(async () => ({
  ok: true, draftToken: 'tok-1', plan,
  previous: plan === 'update-cross-source' ? { version: '0.1.0', sourceWorkspace: 'project-b' } : undefined,
  report: {
    appId: 'kanban-demo', name: '看板演示', version: '0.2.0', fileCount: 3, totalBytes: 4096, digest: 'd'.repeat(64),
    scan: { violations: [] },
    probe: { ok: true, entryLoaded: true, subscribedKeys: ['board'], consoleErrors: [], screenshotTaken: true },
  },
}))

const envelope = (value: unknown): { error?: { code: string } } & Record<string, unknown> => value as { error?: { code: string } } & Record<string, unknown>

describe('app_publish approval policy', () => {
  it('installs same-source updates without asking', async () => {
    const svc = service(prepareOK('update-same-source'), 'update-same-source')
    const ask = askFace('approve')
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask } })
    const result = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(ask).not.toHaveBeenCalled()
    expect(svc.commitPublish).toHaveBeenCalledWith(expect.anything(), 'tok-1', false)
    expect(result.error).toBeUndefined()
    expect(result.plan).toBe('update-same-source')
  })

  it('asks on first publish and commits after approval', async () => {
    const svc = service(prepareOK('first'))
    const ask = askFace('approve')
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask } })
    const result = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(ask).toHaveBeenCalledTimes(1)
    const question = (ask as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].questions[0]
    expect(question.header).toBe('发布审批')
    expect(question.detail).toContain('可随时移除')
    expect(question.detail).toContain('桥订阅验证')
    expect(svc.commitPublish).toHaveBeenCalledWith(expect.anything(), 'tok-1', false)
    expect(result.note).toContain('global desktop')
  })

  it('declines count up, abort the draft, and ban after two', async () => {
    const svc = service(prepareOK('first'))
    const ask = askFace('decline')
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask } })
    const first = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(first.error?.code).toBe('USER_DECLINED')
    expect(svc.abortPublish).toHaveBeenCalledWith(expect.anything(), 'tok-1')
    expect(svc.commitPublish).not.toHaveBeenCalled()
    const second = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(second.error?.code).toBe('USER_DECLINED')
    const third = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(third.error?.code).toBe('USER_DECLINED')
    expect(String(third.error?.message)).toContain('banned')
    // The third attempt never reached the service: banned short-circuits.
    expect(svc.preparePublish).toHaveBeenCalledTimes(2)
  })

  it('maps an explicit ask cancel to USER_DECLINED and discards the draft', async () => {
    const svc = service(prepareOK('first'))
    const ask = askFace('cancel')
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask } })
    const result = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(result.error?.code).toBe('USER_DECLINED')
    expect(svc.abortPublish).toHaveBeenCalledWith(expect.anything(), 'tok-1')
  })

  it('rethrows aborted asks (session end) after discarding the draft', async () => {
    const svc = service(prepareOK('first'))
    const ask = askFace('abort')
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask } })
    await expect(tool.execute({ appId: 'kanban-demo' }, execWith())).rejects.toThrow('ask_user_question')
    expect(svc.abortPublish).toHaveBeenCalledWith(expect.anything(), 'tok-1')
    expect(svc.commitPublish).not.toHaveBeenCalled()
  })

  it('marks cross-source updates with the drift header', async () => {
    const svc = service(prepareOK('update-cross-source'))
    const ask = askFace('approve')
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask } })
    await tool.execute({ appId: 'kanban-demo' }, execWith())
    const question = (ask as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].questions[0]
    expect(question.header).toBe('异源更新确认')
    expect(question.question).toContain('project-b')
  })

  it('rejects illegal app ids before touching the service', async () => {
    const svc = service(prepareOK('first'))
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask: askFace('approve') } })
    const result = envelope(await tool.execute({ appId: 'Bad_Id' }, execWith()))
    expect(result.error?.code).toBe('APP_ID_INVALID')
    expect(svc.preparePublish).not.toHaveBeenCalled()
  })

  it('surfaces gate failures with their machine codes', async () => {
    const svc = service(vi.fn(async () => ({ ok: false, code: 'VERSION_DOWNGRADED', message: 'lower' })))
    const tool = createAppPublishTool({ appStage: svc, userQuestions: { ask: askFace('approve') } })
    const result = envelope(await tool.execute({ appId: 'kanban-demo' }, execWith()))
    expect(result.error?.code).toBe('VERSION_DOWNGRADED')
  })
})

void (null as unknown as AppPublishEnvironment)
