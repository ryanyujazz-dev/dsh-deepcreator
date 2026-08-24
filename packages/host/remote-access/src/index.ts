import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-storage-domain'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { LanGateway, type GatewayStatus } from './gateway.ts'
import { REMOTE_ACCESS_DOMAIN, type RemoteAccessDomain } from './storage.ts'
import { REMOTE_ACCESS_PORT, REMOTE_DEVICE_MAX_IDLE_MS, type RemoteAccessResult, type RemoteAccessStatus, type RemoteDevice, type RemotePairingRequest, type RemotePairingTicket } from './types.ts'

export * from './types.ts'

declare module '@deepseek-ai/cordis' { interface Context { remoteAccess: RemoteAccessService } }

interface RemoteAccessSettings { enabled: boolean; port: number }
const SETTINGS_NS = settingsNamespace('remote-access')
const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.natural().min(1).max(65_535).default(REMOTE_ACCESS_PORT),
})

function failure<T>(code: 'DISABLED' | 'NOT_FOUND' | 'EXPIRED' | 'INVALID_STATE' | 'START_FAILED', message: string): RemoteAccessResult<T> {
  return { ok: false, code, message }
}

export class RemoteAccessService extends TypertRemoteService {
  static inject = ['webServer', 'settings', 'storage', 'storageDomain']
  private readonly settingsScope
  private readonly domainPromise: Promise<RemoteAccessDomain>
  private gateway: LanGateway | undefined
  private gatewayStatus: GatewayStatus | undefined
  private startError: string | undefined
  private operation: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(ctx: Context) {
    super(ctx, 'remoteAccess', { namespace: 'remote-access' })
    this.settingsScope = ctx.settings.register<RemoteAccessSettings>(SETTINGS_NS, settingsSchema)
    this.domainPromise = ctx.storage.domain.open(REMOTE_ACCESS_DOMAIN)
    ctx.effect(() => {
      const unwatch = this.settingsScope.watch(async next => { await this.reconcile(next) })
      void this.reconcile(this.settingsScope.get())
      return async () => {
        this.disposed = true
        unwatch()
        await this.enqueue(async () => { await this.stopGateway() })
        await (await this.domainPromise).close()
      }
    }, 'remote-access: lifecycle')
  }

  @Remote('status')
  status(): RemoteAccessStatus {
    const settings = this.settingsScope.get()
    return {
      enabled: settings.enabled,
      running: this.gateway !== undefined,
      port: settings.port,
      addresses: this.gatewayStatus?.addresses ?? [],
      transport: 'http',
      ...(this.gatewayStatus?.hostName === undefined ? {} : { hostName: this.gatewayStatus.hostName }),
      ...(this.startError === undefined ? {} : { error: this.startError }),
    }
  }

  @Remote('setEnabled')
  async setEnabled(enabled: boolean): Promise<RemoteAccessResult<RemoteAccessStatus>> {
    await this.settingsScope.update({ enabled })
    await this.operation
    if (enabled && this.gateway === undefined) return failure('START_FAILED', this.startError ?? 'Remote access failed to start.')
    return { ok: true, value: this.status() }
  }

  @Remote('createPairingTicket')
  async createPairingTicket(): Promise<RemoteAccessResult<RemotePairingTicket>> {
    const gateway = this.gateway
    if (gateway === undefined) return failure('DISABLED', 'Enable remote access before connecting a device.')
    return { ok: true, value: await gateway.createTicket() }
  }

  @Remote('pending')
  pending(): RemotePairingRequest[] { return this.gateway?.listPending() ?? [] }

  @Remote('approve')
  async approve(requestId: string): Promise<RemoteAccessResult<{ approved: true }>> {
    const gateway = this.gateway
    if (gateway === undefined) return failure('DISABLED', 'Remote access is disabled.')
    if (!await gateway.approve(requestId)) return failure('NOT_FOUND', 'Pairing request was not found or is no longer pending.')
    return { ok: true, value: { approved: true } }
  }

  @Remote('reject')
  reject(requestId: string): RemoteAccessResult<{ rejected: true }> {
    const gateway = this.gateway
    if (gateway === undefined) return failure('DISABLED', 'Remote access is disabled.')
    if (!gateway.reject(requestId)) return failure('NOT_FOUND', 'Pairing request was not found or is no longer pending.')
    return { ok: true, value: { rejected: true } }
  }

  @Remote('devices')
  async devices(): Promise<RemoteDevice[]> {
    const table = (await this.domainPromise).table('devices')
    const now = Date.now()
    const entries = [...table.entries()]
    await Promise.all(entries.filter(([, record]) => now - record.lastConnectedAt > REMOTE_DEVICE_MAX_IDLE_MS).map(([id]) => table.delete(id)))
    return entries.filter(([, record]) => now - record.lastConnectedAt <= REMOTE_DEVICE_MAX_IDLE_MS).map(([, record]) => ({ id: record.id, name: record.name, firstConnectedAt: record.firstConnectedAt, lastConnectedAt: record.lastConnectedAt })).sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
  }

  @Remote('revoke')
  async revoke(deviceId: string): Promise<RemoteAccessResult<{ revoked: boolean }>> {
    return { ok: true, value: { revoked: await (await this.domainPromise).table('devices').delete(deviceId) } }
  }

  @Remote('revokeAll')
  async revokeAll(): Promise<RemoteAccessResult<{ revoked: number }>> {
    const table = (await this.domainPromise).table('devices')
    const ids = [...table.keys()]
    await Promise.all(ids.map(id => table.delete(id)))
    return { ok: true, value: { revoked: ids.length } }
  }

  private async reconcile(settings: RemoteAccessSettings): Promise<void> {
    await this.enqueue(async () => {
      if (this.disposed || !settings.enabled) { await this.stopGateway(); return }
      if (this.gateway !== undefined && this.gatewayStatus?.port === settings.port) return
      await this.stopGateway()
      await this.startGateway(settings.port)
    })
  }

  private async startGateway(port: number): Promise<void> {
    try {
      const domain = await this.domainPromise
      let hostId = domain.global.get().hostId
      if (hostId === '') { hostId = randomUUID(); await domain.global.set({ hostId }) }
      const gateway = new LanGateway({
        port,
        innerPort: this.ctx.webServer.port,
        hostId,
        domain,
        onDeviceSeen: () => {},
      })
      const status = await gateway.start()
      this.gateway = gateway
      this.gatewayStatus = status
      this.startError = undefined
    } catch (error) {
      this.gateway = undefined
      this.gatewayStatus = undefined
      this.startError = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn(`remote-access: ${this.startError}`)
    }
  }

  private async stopGateway(): Promise<void> {
    const gateway = this.gateway
    this.gateway = undefined
    this.gatewayStatus = undefined
    if (gateway !== undefined) await gateway.close()
  }

  private async enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.operation.then(operation, operation)
    this.operation = next.catch(() => {})
    await next
  }
}

export default RemoteAccessService
