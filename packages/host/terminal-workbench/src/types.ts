export type TerminalWorkbenchErrorCode =
  | 'DUPLICATE_BACKEND' | 'DUPLICATE_NAME' | 'FOREIGN_SESSION' | 'NO_BACKEND'
  | 'NO_SESSION' | 'OWNER_NOT_LIVE' | 'SEND_ACTIVE' | 'SERVICE_DISPOSING'
  | 'INVALID_REQUEST' | 'NOT_INTERACTIVE' | 'UNKNOWN'

export type TerminalSignalName = 'SIGINT' | 'SIGTERM' | 'SIGKILL' | 'SIGTSTP' | 'SIGHUP'
export type TerminalWaitReason = 'stdin_read' | 'inferred_idle' | 'timeout' | 'session_exit'

export type TerminalStatus =
  | { kind: 'running' }
  | { kind: 'exited'; exitCode: number | null; signal: string | null }

export interface TerminalSessionView {
  sessionId: string
  name?: string
  type: string
  pid?: number
  status: TerminalStatus
  interactive?: boolean
  shell?: string
  cwd?: string
  platform?: string
}

export interface TerminalSpawnRequest {
  type: string
  name?: string
  cwd?: string
}

export interface TerminalSpawnView extends TerminalSessionView {
  motd: string
}

export interface TerminalReadRequest {
  offset?: number
  count?: number
}

export interface TerminalReadPage {
  text: string
  totalLines: number
  lineBegin: number
  lineEnd: number
  truncated: boolean
}

export interface TerminalRawReadPage {
  data: string
  nextCursor: number
  truncated: boolean
  hasMore: boolean
  status: TerminalStatus
}

export interface TerminalResizeView {
  cols: number
  rows: number
}

export interface TerminalSendView {
  viewport: string
  waitReason: TerminalWaitReason
  sessionStatus: TerminalStatus
  truncated: boolean
}

export interface TerminalSignalView {
  delivered: true
  targetPgid: number
}

export interface TerminalWorkbenchFailure {
  ok: false
  code: TerminalWorkbenchErrorCode
  message: string
}

export type TerminalBackendsResult = { ok: true; backends: string[] } | TerminalWorkbenchFailure
export type TerminalListResult = { ok: true; sessions: TerminalSessionView[] } | TerminalWorkbenchFailure
export type TerminalSpawnRemoteResult = { ok: true; session: TerminalSpawnView } | TerminalWorkbenchFailure
export type TerminalReadRemoteResult = { ok: true; page: TerminalReadPage } | TerminalWorkbenchFailure
export type TerminalSendRemoteResult = { ok: true; result: TerminalSendView } | TerminalWorkbenchFailure
export type TerminalSignalRemoteResult = { ok: true; result: TerminalSignalView } | TerminalWorkbenchFailure
export type TerminalKillRemoteResult = { ok: true; closed: boolean } | TerminalWorkbenchFailure
export type TerminalRawReadRemoteResult = { ok: true; page: TerminalRawReadPage } | TerminalWorkbenchFailure
export type TerminalInputRemoteResult = { ok: true; accepted: true } | TerminalWorkbenchFailure
export type TerminalResizeRemoteResult = { ok: true; size: TerminalResizeView } | TerminalWorkbenchFailure
