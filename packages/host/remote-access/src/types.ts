export const REMOTE_ACCESS_PORT = 43_127
export const PAIRING_TICKET_TTL_MS = 120_000
export const REMOTE_DEVICE_MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000

export interface RemoteAccessStatus {
  enabled: boolean
  running: boolean
  port: number
  addresses: string[]
  transport: 'http'
  hostName?: string
  error?: string
}

export interface RemotePairingTicket {
  setupUrl: string
  qrDataUrl: string
  expiresAt: number
}

export interface RemotePairingRequest {
  requestId: string
  deviceName: string
  code: string
  createdAt: number
  expiresAt: number
}

export interface RemoteDevice {
  id: string
  name: string
  firstConnectedAt: number
  lastConnectedAt: number
}

export interface RemoteCapabilities {
  remote: true
  deviceId: string
  deviceName: string
  hostName: string
  transport: 'http'
  allowedFeatures: readonly ['sessions', 'messages', 'approvals', 'questions', 'artifacts', 'review', 'activity']
}

export type RemoteAccessResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'DISABLED' | 'NOT_FOUND' | 'EXPIRED' | 'INVALID_STATE' | 'START_FAILED'; message: string }

export interface RemoteDeviceRecord extends RemoteDevice {
  tokenHash: string
}
