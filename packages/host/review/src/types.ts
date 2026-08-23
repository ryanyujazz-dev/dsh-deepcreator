export type ReviewScope = 'unstaged' | 'staged' | 'uncommitted' | { turn: number }
export type ReviewWorkspaceKind = 'git' | 'filesystem'
export interface ReviewLocation { repository?: string }
export type ReviewEntryKind = 'file' | 'symlink' | 'repository' | 'submodule'
export type ReviewPresentation = 'text' | 'binary' | 'rename' | 'mode' | 'empty' | 'repository' | 'submodule' | 'unknown'
export type ReviewLineStatsState = 'available' | 'not-applicable' | 'unknown'

export interface ReviewFileStatus {
  path: string
  oldPath?: string
  index: string
  workingTree: string
  kind?: ReviewEntryKind
  presentation?: ReviewPresentation
  /** Workspace-relative POSIX path of the repository which owns this entry. */
  repository?: string
}

/** Lightweight per-file line statistics returned independently of source snapshots. */
export interface ReviewFileSummary {
  path: string
  oldPath?: string
  additions?: number
  deletions?: number
  binary?: boolean
  kind?: ReviewEntryKind
  presentation?: ReviewPresentation
  lineStatsState?: ReviewLineStatsState
  repository?: string
}

export interface ReviewSourceSnapshot {
  revision: 'head' | 'index' | 'worktree' | 'turn-start' | 'turn-end'
  text: string | null
  lineCount?: number
}

export interface ReviewPatchLayer {
  kind: 'staged' | 'working-tree' | 'uncommitted' | 'turn'
  patch: string
  oldSource: ReviewSourceSnapshot
  newSource: ReviewSourceSnapshot
}

export type ReviewConsistency = 'live-exact' | 'live-reconciling' | 'authoritative'

/** One file in a generation-bound Review manifest. */
export type ReviewManifestFile = ReviewFileStatus & Omit<ReviewFileSummary, keyof ReviewFileStatus | 'lineStatsState'> & {
  /** Statistics can arrive with the first patch batch for a live exact Turn. */
  lineStatsState?: ReviewLineStatsState | 'pending'
}

/** Lightweight, source-free patch layer used by the generation protocol. */
export interface ReviewPatchLayerV2 {
  kind: ReviewPatchLayer['kind']
  patch: string
  oldRevision: ReviewSourceSnapshot['revision']
  newRevision: ReviewSourceSnapshot['revision']
  oldLineCount?: number
  newLineCount?: number
}

export interface ReviewPatchFile {
  path: string
  oldPath?: string
  kind?: ReviewEntryKind
  presentation?: ReviewPresentation
  lineStatsState?: ReviewLineStatsState
  additions?: number
  deletions?: number
  layers: ReviewPatchLayerV2[]
}

export type ReviewTurnFileState = 'pending' | 'committed' | 'reverted'

export interface ReviewTurnFile {
  path: string
  oldPath?: string
  state: ReviewTurnFileState
  /** Line counts captured from this turn's start → end diff. */
  additions?: number
  deletions?: number
  /** Workspace-relative POSIX owner repository; absent means the root repository. */
  repository?: string
  repositoryPath?: string
  kind?: ReviewEntryKind
  presentation?: ReviewPresentation
  lineStatsState?: ReviewLineStatsState
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
  undoDisabledReason?: 'cross-repository'
  files: ReviewTurnFile[]
}

export type ReviewHistoryResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; head?: string | null; turns: ReviewTurnHistory[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'READ_FAILED'; message: string }

export type ReviewManifestResult =
  | {
    ok: true
    generation: string
    epoch: number
    consistency: ReviewConsistency
    repositoryRoot: string
    workspaceKind: ReviewWorkspaceKind
    head?: string | null
    branch: string
    scope: ReviewScope
    location?: ReviewLocation
    additions: number
    deletions: number
    files: ReviewManifestFile[]
    turns: ReviewTurnHistory[]
    /** Metadata-first manifests defer expensive line statistics. */
    summaryPending?: boolean
    /** Metadata-first manifests defer historical reconciliation. */
    historyPending?: boolean
  }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewPatchesResult =
  | { ok: true; generation: string; files: ReviewPatchFile[] }
  | { ok: false; code: 'STALE_GENERATION' | 'OUTSIDE_REPOSITORY' | 'READ_FAILED'; message: string }

export type ReviewSourceSide = 'old' | 'new'
export type ReviewSourceResult =
  | { ok: true; generation: string; path: string; side: ReviewSourceSide; text: string | null }
  | { ok: false; code: 'STALE_GENERATION' | 'OUTSIDE_REPOSITORY' | 'READ_FAILED'; message: string }

export type ReviewProbeResult =
  | { ok: true; epoch: number; changed: boolean }
  | { ok: false; code: 'NO_WORKSPACE' | 'READ_FAILED'; message: string }

export type ReviewStatusResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; branch: string; scope: ReviewScope; location?: ReviewLocation; files: ReviewFileStatus[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewSummaryResult =
  | {
    ok: true
    repositoryRoot: string
    workspaceKind: ReviewWorkspaceKind
    scope: ReviewScope
    location?: ReviewLocation
    additions: number
    deletions: number
    files: ReviewFileSummary[]
  }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewDiffResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; scope: ReviewScope; location?: ReviewLocation; path: string; oldPath?: string; kind?: ReviewEntryKind; presentation?: ReviewPresentation; lineStatsState?: ReviewLineStatsState; layers: ReviewPatchLayer[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'OUTSIDE_REPOSITORY' | 'TURN_NOT_FOUND' | 'READ_FAILED'; message: string }

export type ReviewChecksResult =
  | { ok: true; repositoryRoot: string; workspaceKind: ReviewWorkspaceKind; clean: boolean; output: string }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE'; message: string }

export type ReviewUndoTurnResult =
  | { ok: true; repositoryRoot: string; turn: number; revertedFiles: string[] }
  | { ok: false; code: 'NO_WORKSPACE' | 'NOT_REPOSITORY' | 'OUTSIDE_WORKSPACE' | 'TURN_NOT_FOUND' | 'NOT_LATEST' | 'NOTHING_TO_UNDO' | 'CROSS_REPOSITORY' | 'CONFLICT' | 'APPLY_FAILED'; message: string }
