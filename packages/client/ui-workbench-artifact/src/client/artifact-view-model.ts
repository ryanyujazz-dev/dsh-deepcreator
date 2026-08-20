import { diffLanguageFromPath } from '@ryanyujazz/dsh-client-ui-primitives'
import type { FileArtifactRecord } from './artifact-contract.ts'

export type MarkdownRenderMode = 'preview' | 'code'

/** Whether a file can use the conversation-grade Markdown preview. */
export function isMarkdownArtifactPath(path: string): boolean {
  const lang = diffLanguageFromPath(path)
  return lang === 'markdown' || lang === 'mdx'
}

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
function artifactTabPaths(records: readonly FileArtifactRecord[], tabs: readonly string[]): string[] {
  const paths = records.map(record => record.path)
  const seen = new Set(paths)
  for (const path of tabs) {
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

export function artifactTabLabels(records: readonly FileArtifactRecord[], tabs: readonly string[] = []): Record<string, string> {
  const counts = new Map<string, number>()
  const labels: Record<string, string> = {}
  for (const path of artifactTabPaths(records, tabs)) {
    const name = basename(path)
    const seen = (counts.get(name) ?? 0) + 1
    counts.set(name, seen)
    labels[path] = seen === 1 ? name : `${name} ${seen}`
  }
  return labels
}

/** Artifact instance ids are the real file paths used to resolve tab glyphs. */
export function artifactTabFilePaths(records: readonly FileArtifactRecord[], tabs: readonly string[] = []): Record<string, string> {
  return Object.fromEntries(artifactTabPaths(records, tabs).map(path => [path, path]))
}

/** Visible breadcrumb segments; absolute slash roots stay in the accessible full path only. */
export function artifactPathSegments(path: string): string[] {
  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/').filter(Boolean)
  return segments.length > 0 ? segments : [path]
}

/** Parent directory passed to the official Host path opener. */
export function artifactParentDirectory(path: string): string {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (separator === -1) return '.'
  if (separator === 0) return path.slice(0, 1)
  if (separator === 2 && path[1] === ':') return path.slice(0, 3)
  return path.slice(0, separator)
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
