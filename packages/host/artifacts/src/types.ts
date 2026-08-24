/**
 * Pure wire types for the read-only artifact file reader.
 *
 * The panel's list is a Client-side session-event projection of the official
 * deliverables mechanism (files the model actually wrote), so this Host
 * surface owns only the one remote that reads file content for an open
 * instance. No business state lives here.
 */

export interface ArtifactTextReadOk {
  ok: true
  kind: 'text'
  content: string
}

export interface ArtifactImageReadOk {
  ok: true
  kind: 'image'
  /** Same-origin unguessable capability URL; the browser never receives a filesystem path. */
  url: string
  mediaType: string
}

export interface ArtifactPdfReadOk {
  ok: true
  kind: 'pdf'
  /** Same-origin unguessable capability URL consumed by the embedded PDF viewer. */
  url: string
  mediaType: 'application/pdf'
}

export interface ArtifactDocumentReadOk {
  ok: true
  kind: 'document'
  /** DOCX is structural HTML; legacy DOC is extracted plain text. */
  contentType: 'html' | 'text'
  content: string
}

export type ArtifactReadOk =
  | ArtifactTextReadOk
  | ArtifactImageReadOk
  | ArtifactPdfReadOk
  | ArtifactDocumentReadOk

export interface ArtifactReadError {
  ok: false
  code: 'NOT_FOUND' | 'NO_WORKSPACE' | 'OUTSIDE_WORKSPACE' | 'READ_FAILED'
  message: string
}

export type ArtifactReadResult = ArtifactReadOk | ArtifactReadError

export interface ArtifactPreviewOk {
  ok: true
  /** Loopback-only HTTP URL suitable for Browser Runtime navigation. */
  url: string
  /** Canonical workspace path suitable for the native OS path opener. */
  path: string
}

export interface ArtifactPreviewError {
  ok: false
  code: ArtifactReadError['code'] | 'NOT_PREVIEWABLE' | 'PREVIEW_FAILED'
  message: string
}

export type ArtifactPreviewResult = ArtifactPreviewOk | ArtifactPreviewError
