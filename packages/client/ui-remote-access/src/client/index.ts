import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { RemoteResult, TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@ryanyujazz/dsh-client-locale/client'
import type {} from '@ryanyujazz/dsh-client-ui-settings/client'
import type {} from '@ryanyujazz/dsh-remote-access/remote'
import type { RemoteAccessResult, RemoteAccessStatus, RemoteCapabilities, RemoteDevice, RemotePairingRequest, RemotePairingTicket } from '@ryanyujazz/dsh-remote-access/types'
import { RemoteSection, type RemoteSectionInjected } from './RemoteSection.tsx'
import { en, zh, type RemoteKey } from './locales.ts'

export type RemoteSurfaceService = { readonly remote: boolean; getCapabilities(): RemoteCapabilities | undefined }
declare module '@deepseek-ai/cordis' { interface Context { remoteSurface: RemoteSurfaceService } }
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'remote-access': RemoteKey } }

const NS = 'remote-access'
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.remote-access']

function unwrap<T>(wire: RemoteResult<T>): T {
  if (!wire.ok) throw new Error(`${wire.error.code}: ${wire.error.message}`)
  return wire.value
}
function business<T>(wire: RemoteAccessResult<T>): T {
  if (!wire.ok) throw new Error(`${wire.code}: ${wire.message}`)
  return wire.value
}

async function fetchCapabilities(): Promise<RemoteCapabilities> {
  const response = await fetch('/deepcreator/remote/capabilities', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`REMOTE_${response.status}: ${await response.text()}`)
  return await response.json() as RemoteCapabilities
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-remote-access: dictionaries')
  const connection = ctx.get('connection') as ConnectionHandle
  const isRemote = !connection.isLoopback
  let capabilities: RemoteCapabilities | undefined
  const surface: RemoteSurfaceService = { remote: isRemote, getCapabilities: () => capabilities }
  const disposeSurface = ctx.reflect.provide('remoteSurface', surface)
  if (isRemote) {
    document.documentElement.dataset.deepcreatorRemote = 'true'
  }
  const injectedBase = {
    remote: isRemote,
    loadCapabilities: async () => { capabilities = await fetchCapabilities(); return capabilities },
    disconnect: async () => { const response = await fetch('/deepcreator/remote/disconnect', { method: 'POST' }); if (!response.ok) throw new Error(await response.text()) },
  }
  const t = ctx.locale.bind(NS)
  const namespace = isRemote ? undefined : (ctx.get('remote') as TypertClientRemote)['remote-access']
  const unavailable = async (): Promise<never> => { throw new Error('Remote administration is available only on the desktop Host.') }
  const injected = (): RemoteSectionInjected => ({
    ...injectedBase,
    loadStatus: namespace === undefined ? unavailable : async (): Promise<RemoteAccessStatus> => unwrap(await namespace.status()),
    setEnabled: namespace === undefined ? unavailable : async enabled => business(unwrap(await namespace.setEnabled(enabled))),
    createTicket: namespace === undefined ? unavailable : async (): Promise<RemotePairingTicket> => business(unwrap(await namespace.createPairingTicket())),
    loadPending: namespace === undefined ? unavailable : async (): Promise<RemotePairingRequest[]> => unwrap(await namespace.pending()),
    approve: namespace === undefined ? unavailable : async requestId => { business(unwrap(await namespace.approve(requestId))) },
    reject: namespace === undefined ? unavailable : async requestId => { business(unwrap(await namespace.reject(requestId))) },
    loadDevices: namespace === undefined ? unavailable : async (): Promise<RemoteDevice[]> => unwrap(await namespace.devices()),
    revoke: namespace === undefined ? unavailable : async deviceId => { business(unwrap(await namespace.revoke(deviceId))) },
    revokeAll: namespace === undefined ? unavailable : async () => { business(unwrap(await namespace.revokeAll())) },
  })
  const disposeSection = ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'remote', order: 10, label: () => t('nav'), locale: NS, inject: injected }, RemoteSection))
  return async () => {
    document.documentElement.removeAttribute('data-deepcreator-remote')
    await disposeSection()
    await disposeSurface()
  }
}
