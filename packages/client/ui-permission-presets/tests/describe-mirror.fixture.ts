/**
 * Narrow doubles for the official Settings machinery this package consumes.
 * The fork takes `dsh-client-ui-settings` from npm, whose bundle entry exports
 * only `apply`/`inject` — the schema and mirror classes stay module-internal.
 * These doubles implement exactly the faces `settings-store.ts` consumes, with
 * the observable semantics documented on the npm package's declarations.
 */

import Schema from '@deepseek-ai/schemastery'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  SettingsDescribeFace, SettingsMirrorSnapshot, SettingsSchemaService,
} from '@deepseek-ai/dsh-client-ui-settings/client'

type DescribeResult =
  | { ok: true; value: { writable: boolean; hasDocument?: boolean; namespaces: SettingsNamespaceView[] } }
  | { ok: false; error: Error }

interface DescribeRemote { describe(): Promise<DescribeResult> }

/** Schema operations double: schemastery rehydrates the serialized uid/refs tree directly. */
export const TEST_SCHEMA = {
  rehydrate: (serialized: unknown) => new Schema(serialized as never),
  nodeAtPath: (root: Schema, path: readonly string[]) => {
    let node: Schema | undefined = root
    for (const key of path) {
      node = node?.type === 'object' ? node.dict?.[key] : undefined
    }
    return node
  },
} satisfies Pick<SettingsSchemaService, 'rehydrate' | 'nodeAtPath'>

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Mirror double: one describe read behind a snapshot store, with the write-answer fold. */
export class TestDescribeMirror implements SettingsDescribeFace {
  private snapshot: SettingsMirrorSnapshot
  private readonly listeners = new Set<() => void>()
  private readonly remote: DescribeRemote
  private inFlight: Promise<void> | undefined
  private rerun = false

  constructor(ctx: { remote: { settings: DescribeRemote } }, persistence: 'host' | 'memory' = 'host') {
    this.remote = ctx.remote.settings
    this.snapshot = persistence === 'memory'
      ? { status: 'unavailable', view: undefined, error: null }
      : { status: 'idle', view: undefined, error: null }
  }

  getSnapshot(): SettingsMirrorSnapshot { return this.snapshot }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async load(): Promise<void> {
    if (this.snapshot.status === 'unavailable') return
    if (this.inFlight !== undefined) {
      this.rerun = true
      return this.inFlight
    }
    const read = (async () => {
      this.publish({ ...this.snapshot, status: 'loading' })
      let answer: DescribeResult
      try {
        answer = await this.remote.describe()
      } catch (error) {
        this.readFailed(messageOf(error))
        return
      }
      if (!answer.ok) {
        this.readFailed(messageOf(answer.error))
        return
      }
      this.publish({ status: 'ready', view: answer.value, error: null })
    })()
    this.inFlight = read
    await read
    this.inFlight = undefined
    if (this.rerun) {
      this.rerun = false
      await this.load()
    }
  }

  async ensure(): Promise<void> {
    if (this.snapshot.status === 'idle') await this.load()
  }

  acceptView(view: SettingsNamespaceView): void {
    const held = this.snapshot.view
    if (held === undefined) return
    const namespaces = [...held.namespaces.filter(entry => entry.ns !== view.ns), view]
    this.publish({ ...this.snapshot, view: { ...held, namespaces } })
  }

  /** A failed read keeps the held view serving ('ready' persists); without one it returns to 'idle' with the error held. */
  private readFailed(message: string): void {
    this.publish(this.snapshot.view === undefined
      ? { status: 'idle', view: undefined, error: message }
      : { ...this.snapshot, error: message })
  }

  private publish(next: SettingsMirrorSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}
