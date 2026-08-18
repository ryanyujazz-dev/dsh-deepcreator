/**
 * Pure wire types for the read-only artifact file reader.
 *
 * The panel's list is a Client-side session-event projection of the official
 * deliverables mechanism (files the model actually wrote), so this Host
 * surface owns only the one remote that reads file content for an open
 * instance. No business state lives here.
 */

export interface ArtifactReadOk {
  ok: true
  content: string
}

export interface ArtifactReadError {
  ok: false
  code: 'NOT_FOUND' | 'NO_WORKSPACE' | 'OUTSIDE_WORKSPACE' | 'READ_FAILED'
  message: string
}

export type ArtifactReadResult = ArtifactReadOk | ArtifactReadError
