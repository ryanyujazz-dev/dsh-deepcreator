import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { TypertContext, TypertLookup } from '@deepseek-ai/dsh-typert-protocol'

export interface Agent { readonly id: SessionId; readonly session: Session }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertLookupMap { agent: TypertLookup<Agent, SessionId> }
  interface TypertContextMap { agent: TypertContext<SessionId> }
}
