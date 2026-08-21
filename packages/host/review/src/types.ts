export type ReviewScope = 'unstaged' | 'staged' | 'uncommitted' | { turn: number }
export type ReviewWorkspaceKind = 'git' | 'filesystem'

export interface ReviewFileStatus {
  path: string
  oldPath?: string
  index: string
  workingTree: string
}

/** Lightweight per-file line statistics returned independently of source snapshots. */
export interface ReviewFileSummary {
  path: string
  oldPath?: string
  additions: number
  deletions: number
  binary: boolean
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
  /** Line counts captured from this turn's start → end diff. */
  additions?: number
  deletions?: number
}

export interface ReviewTurnHistory {
  turn: number
  /** True while the official turn is still open and end is a live worktree snapshot. */
  current?: boolean
  totalFiles: number
  remainingFiles: number
  additions?: number
  deletions?: number
  state: 'active' | 'committed' | 'reverted' | 'mixed'
  undoable: boolean
  files: ReviewTurnFile[]
}

export type ReviewHistoryResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; head?: string | null; turns: ReviewTurnHistory[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'READ_FAILED'; message: string }

export type ReviewStatusResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; branch: string; scope: ReviewScope; files: ReviewFileStatus[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewSummaryResult =
  | {
    ok: true
    repositoryRoot: string
    workspaceKind: ReviewWorkspaceKind
    scope: ReviewScope
    additions: number
    deletions: number
    files: ReviewFileSummary[]
  }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewDiffResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; scope: ReviewScope; path: string; oldPath?: string; layers: ReviewPatchLayer[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'OUTSIDE_REPOSITORY' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewChecksResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; clean: boolean; output: string }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }

export type ReviewUndoTurnResult =
  | { ok: true; repositoryRoot: string; turn: number; revertedFiles: string[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'NOT_LATEST' | 'NOTHING_TO_UNDO' | 'CONFLICT' | 'APPLY_FAILED'; message: string }
