/** Pure wire types for session lifecycle administration. */

export interface SessionDeleteOk {
  ok: true
  /** Absolute path of the destroyed session directory. */
  deletedPath: string
}

export interface SessionDeleteError {
  ok: false
  code: 'INVALID_ID' | 'SESSION_ACTIVE' | 'NOT_FOUND' | 'AMBIGUOUS'
  message: string
}

export type SessionDeleteResult = SessionDeleteOk | SessionDeleteError
