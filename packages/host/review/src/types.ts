export interface ReviewFileStatus {
  path: string
  index: string
  workingTree: string
}

export type ReviewStatusResult =
  | { ok: true; repositoryRoot: string; branch: string; files: ReviewFileStatus[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }

export type ReviewDiffResult =
  | { ok: true; repositoryRoot: string; path: string; diff: string }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'OUTSIDE_REPOSITORY' | 'READ_FAILED'; message: string }

export type ReviewChecksResult =
  | { ok: true; repositoryRoot: string; clean: boolean; output: string }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }
