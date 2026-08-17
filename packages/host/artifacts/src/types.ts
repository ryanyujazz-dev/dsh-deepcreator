export type ArtifactLocator =
  | { type: 'workspace-path'; path: string }
  | { type: 'blob'; blobId: string }
  | { type: 'url'; url: string }

export interface ArtifactRecord {
  id: string
  sessionId: string
  workspaceId?: string
  kind: 'plan' | 'document' | 'code' | 'image' | 'report' | string
  title: string
  mime?: string
  locator: ArtifactLocator
  revision: string
  status: 'creating' | 'ready' | 'failed' | 'stale'
  createdAt: number
  updatedAt: number
}

export interface ArtifactDeclareRequest {
  id?: string
  workspaceId?: string
  kind: string
  title: string
  mime?: string
  locator: ArtifactLocator
  status?: 'creating' | 'ready' | 'failed' | 'stale'
}

export type ArtifactListResult =
  | { ok: true; artifacts: ArtifactRecord[] }
  | { ok: false; code: 'INVALID_LOG'; message: string }

export type ArtifactReadResult =
  | { ok: true; artifact: ArtifactRecord; content: string }
  | { ok: false; code: 'NOT_FOUND' | 'NO_WORKSPACE' | 'OUTSIDE_WORKSPACE' | 'UNSUPPORTED_LOCATOR' | 'READ_FAILED'; message: string }
