export interface ReviewFileStatus {
  path: string
  oldPath?: string
  index: string
  workingTree: string
}

export interface ReviewSourceSnapshot {
  revision: 'head' | 'index' | 'worktree'
  text: string | null
}

export interface ReviewPatchLayer {
  kind: 'staged' | 'working-tree'
  patch: string
  oldSource: ReviewSourceSnapshot
  newSource: ReviewSourceSnapshot
}

export type ReviewStatusResult =
  | { ok: true; repositoryRoot: string; branch: string; files: ReviewFileStatus[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }

export type ReviewDiffResult =
  | { ok: true; repositoryRoot: string; path: string; oldPath?: string; layers: ReviewPatchLayer[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'OUTSIDE_REPOSITORY' | 'READ_FAILED'; message: string }

export type ReviewChecksResult =
  | { ok: true; repositoryRoot: string; clean: boolean; output: string }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }
