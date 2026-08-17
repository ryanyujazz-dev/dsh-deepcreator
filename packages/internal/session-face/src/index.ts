import type { TypertLookup } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from './types.ts'

export type { SessionId } from './types.ts'
export interface SessionHeader { readonly id: SessionId; readonly cwd?: string }
export interface SessionEventMap {}
export type SessionEvent = {
  [T in keyof SessionEventMap]: {
    readonly seq: number
    readonly time: number
    readonly type: T
    readonly data: SessionEventMap[T]
  }
}[keyof SessionEventMap]
export declare class Session {
  readonly id: SessionId
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  append<T extends keyof SessionEventMap>(type: T, data: SessionEventMap[T]): Extract<SessionEvent, { type: T }>
}
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap { session: TypertLookup<Session, SessionId> }
}
