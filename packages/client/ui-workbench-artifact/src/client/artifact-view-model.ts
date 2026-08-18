import type { FileArtifactRecord } from './artifact-contract.ts'

/** Trailing path segment, the part that identifies the file at a glance. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * Tab pills are named after produced file basenames; duplicates get a
 * counter, mirroring the terminal project-name pattern. A later production
 * of the same path keeps its pill identity.
 */
export function artifactTabLabels(records: readonly FileArtifactRecord[]): Record<string, string> {
  const counts = new Map<string, number>()
  const labels: Record<string, string> = {}
  for (const record of records) {
    const name = basename(record.path)
    const seen = (counts.get(name) ?? 0) + 1
    counts.set(name, seen)
    labels[record.path] = seen === 1 ? name : `${name} ${seen}`
  }
  return labels
}

/** Compact locale-neutral age, e.g. `45s`, `3m`, `2h`, `5d`. */
export function formatAge(updatedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
