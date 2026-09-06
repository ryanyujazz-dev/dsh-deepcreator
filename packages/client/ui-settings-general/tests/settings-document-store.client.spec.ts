import { describe, expect, it, vi } from 'vitest'
import type {
  SettingsDescribeFace, SettingsDescribeView, SettingsMirrorSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsDocumentStore } from '../src/client/settings-document-store.ts'

/** A held `settings.describe` answer the mirror would serve. */
function view(hasDocument: boolean): SettingsDescribeView {
  return { writable: true, hasDocument, namespaces: [] }
}

/** The store's remote face: only the settings namespace's open operation. */
type StoreCtx = { remote: { settings: { openSettingsDocument: (...args: never[]) => Promise<unknown> } } }

/**
 * In-memory `SettingsDescribeFace` double: starts from `initial`, lets the
 * test replace part of the mirror snapshot and notify subscribers the way a
 * mirror refresh would, and counts `subscribe`/`ensure` calls.
 */
function stubDescribeFace(initial: Partial<SettingsMirrorSnapshot> = {}): SettingsDescribeFace & {
  publish(next: Partial<SettingsMirrorSnapshot>): void
  subscribeCalls(): number
  ensureCalls(): number
} {
  const listeners = new Set<() => void>()
  let snapshot: SettingsMirrorSnapshot = { status: 'idle', view: undefined, error: null, ...initial }
  let subscribes = 0
  let ensures = 0
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      subscribes += 1
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    ensure() {
      ensures += 1
      return Promise.resolve()
    },
    acceptView: () => undefined,
    publish(next) {
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener()
    },
    subscribeCalls: () => subscribes,
    ensureCalls: () => ensures,
  }
}

function storeOver(
  face: SettingsDescribeFace,
  openSettingsDocument: StoreCtx['remote']['settings']['openSettingsDocument'],
): SettingsDocumentStore {
  return new SettingsDocumentStore({ remote: { settings: { openSettingsDocument } } } as never, face)
}

describe('SettingsDocumentStore', () => {
  it('loads provider metadata and asks the settings domain to open its document', async () => {
    const face = stubDescribeFace({ status: 'ready', view: view(true) })
    const openSettingsDocument = vi.fn(() => Promise.resolve({ ok: true as const, value: { opened: true as const } }))
    const controller = storeOver(face, openSettingsDocument)
    await controller.load()
    expect(controller.store.getSnapshot()).toEqual({
      status: 'ready', opening: false, error: null,
    })
    await controller.open()
    expect(openSettingsDocument).toHaveBeenCalledOnce()
  })

  it('marks absent or failed metadata unavailable without opening anything', async () => {
    const openSettingsDocument = vi.fn(() => Promise.resolve({ ok: true as const, value: { opened: true as const } }))
    const absent = storeOver(stubDescribeFace({ status: 'ready', view: view(false) }), openSettingsDocument)
    await absent.load()
    await absent.open()
    expect(absent.store.getSnapshot().status).toBe('unavailable')
    expect(openSettingsDocument).not.toHaveBeenCalled()

    const failed = storeOver(stubDescribeFace({ status: 'unavailable', error: 'offline' }), openSettingsDocument)
    await failed.load()
    expect(failed.store.getSnapshot()).toMatchObject({ status: 'unavailable', error: 'offline' })

    const rejected = storeOver(
      stubDescribeFace({ status: 'unavailable', error: 'provider failed' }),
      openSettingsDocument,
    )
    await rejected.load()
    expect(rejected.store.getSnapshot()).toMatchObject({
      status: 'unavailable', error: 'provider failed',
    })
  })

  it('collapses concurrent open gestures and recovers after a failure', async () => {
    let resolveOpen!: (answer: { ok: false; error: { code: string; message: string; details: Record<string, never> } }) => void
    const openSettingsDocument = vi.fn(() => new Promise<typeof resolveOpen extends (a: infer A) => void ? A : never>(
      (resolve) => { resolveOpen = resolve },
    ))
    const controller = storeOver(
      stubDescribeFace({ status: 'ready', view: view(true) }),
      openSettingsDocument as never,
    )
    await controller.load()
    const first = controller.open()
    const second = controller.open()
    expect(openSettingsDocument).toHaveBeenCalledOnce()
    resolveOpen({ ok: false, error: { code: 'internal', message: 'no default editor', details: {} } })
    await Promise.all([first, second])
    expect(controller.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false, error: 'no default editor',
    })
  })

  it('follows the shared mirror once across loads, re-deriving on its updates, and resets opening when the open transport rejects', async () => {
    const face = stubDescribeFace({ status: 'ready', view: view(true) })
    const controller = storeOver(face, vi.fn())
    await controller.load()
    await controller.load()
    // Idempotent following: repeated loads never re-subscribe the mirror.
    expect(face.subscribeCalls()).toBe(1)
    face.publish({ status: 'ready', view: view(false) })
    expect(controller.store.getSnapshot().status).toBe('unavailable')
    face.publish({ status: 'ready', view: view(true) })
    expect(controller.store.getSnapshot().status).toBe('ready')

    let rejectOpen!: (reason?: unknown) => void
    const failing = storeOver(
      stubDescribeFace({ status: 'ready', view: view(true) }),
      (() => new Promise((_, reject) => { rejectOpen = reject })) as never,
    )
    await failing.load()
    const opening = failing.open()
    rejectOpen(new Error('transport down'))
    await expect(opening).rejects.toThrow('transport down')
    expect(failing.store.getSnapshot()).toMatchObject({
      status: 'ready', opening: false,
    })
  })
})
