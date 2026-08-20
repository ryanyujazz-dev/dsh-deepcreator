export type ReviewScope = 'unstaged' | 'staged' | 'uncommitted' | { turn: number }

export interface ReviewFileStatus {
  path: string
  oldPath?: string
  index: string
  workingTree: string
}

export interface ReviewSourceSnapshot {
  revision: 'head' | 'index' | 'worktree' | 'turn-start' | 'turn-end'
  text: string | null
}

export interface ReviewPatchLayer {
  kind: 'staged' | 'working-tree' | 'uncommitted' | 'turn'
  patch: string
  oldSource: ReviewSourceSnapshot
  newSource: ReviewSourceSnapshot
}

export type ReviewTurnFileState = 'pending' | 'committed' | 'reverted'

export interface ReviewTurnFile {
  path: string
  oldPath?: string
  state: ReviewTurnFileState
}

export interface ReviewTurnHistory {
  turn: number
  totalFiles: number
  remainingFiles: number
  state: 'active' | 'committed' | 'reverted' | 'mixed'
  undoable: boolean
  files: ReviewTurnFile[]
}

export type ReviewHistoryResult =
  | { ok: true; repositoryRoot: string; head?: string | null; turns: ReviewTurnHistory[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'READ_FAILED'; message: string }

export type ReviewStatusResult =
  | { ok: true; repositoryRoot: string; branch: string; scope: ReviewScope; files: ReviewFileStatus[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewDiffResult =
  | { ok: true; repositoryRoot: string; scope: ReviewScope; path: string; oldPath?: string; layers: ReviewPatchLayer[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'OUTSIDE_REPOSITORY' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewChecksResult =
  | { ok: true; repositoryRoot: string; clean: boolean; output: string }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }

export type ReviewUndoTurnResult =
  | { ok: true; repositoryRoot: string; turn: number; revertedFiles: string[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'NOT_LATEST' | 'NOTHING_TO_UNDO' | 'CONFLICT' | 'APPLY_FAILED'; message: string }
