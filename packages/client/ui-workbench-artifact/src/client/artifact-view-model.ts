import { diffLanguageFromPath } from '@ryanyujazz/dsh-client-ui-primitives'
import type { FileArtifactRecord, PlanArtifactRecord } from './artifact-contract.ts'

export type MarkdownRenderMode = 'preview' | 'code'

const PLAN_INSTANCE_PREFIX = 'deepcreator-plan:'

export function planInstanceId(callId: string): string {
  return `${PLAN_INSTANCE_PREFIX}${encodeURIComponent(callId)}`
}

export function planCallIdFromInstance(instanceId: string): string | null {
  if (!instanceId.startsWith(PLAN_INSTANCE_PREFIX)) return null
  try {
    return decodeURIComponent(instanceId.slice(PLAN_INSTANCE_PREFIX.length))
  } catch {
    return null
  }
}

/** Plan tabs use their headings; repeated headings receive stable counters. */
export function planTabLabels(records: readonly PlanArtifactRecord[], tabs: readonly string[]): Record<string, string> {
  const plans = new Map(records.map(record => [planInstanceId(record.callId), record]))
  const ids = [...plans.keys(), ...tabs.filter(id => planCallIdFromInstance(id) !== null && !plans.has(id))]
  const counts = new Map<string, number>()
  const labels: Record<string, string> = {}
  for (const id of ids) {
    const title = plans.get(id)?.title ?? 'Plan'
    const seen = (counts.get(title) ?? 0) + 1
    counts.set(title, seen)
    labels[id] = seen === 1 ? title : `${title} ${seen}`
  }
  return labels
}

/** Whether a file can use the conversation-grade Markdown preview. */
export function isMarkdownArtifactPath(path: string): boolean {
  const lang = diffLanguageFromPath(path)
  return lang === 'markdown' || lang === 'mdx'
}

/** Browser-previewable produced entry files. */
export function isHtmlArtifactPath(path: string): boolean {
  return /\.html?$/i.test(path)
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
function artifactTabPaths(records: readonly FileArtifactRecord[], tabs: readonly string[], normalize: (path: string) => string): string[] {
  const paths = records.map(record => normalize(record.path))
  const seen = new Set(paths)
  for (const value of tabs) {
    const path = normalize(value)
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

export function artifactTabLabels(records: readonly FileArtifactRecord[], tabs: readonly string[] = [], normalize: (path: string) => string = path => path): Record<string, string> {
  const counts = new Map<string, number>()
  const labels: Record<string, string> = {}
  for (const path of artifactTabPaths(records, tabs, normalize)) {
    const name = basename(path)
    const seen = (counts.get(name) ?? 0) + 1
    counts.set(name, seen)
    labels[path] = seen === 1 ? name : `${name} ${seen}`
  }
  return labels
}

/** Artifact instance ids are the real file paths used to resolve tab glyphs. */
export function artifactTabFilePaths(records: readonly FileArtifactRecord[], tabs: readonly string[] = [], normalize: (path: string) => string = path => path): Record<string, string> {
  return Object.fromEntries(artifactTabPaths(records, tabs.filter(tab => planCallIdFromInstance(tab) === null), normalize).map(path => [path, path]))
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

/**
 * Resolve one scheme-free Markdown image destination against the document's
 * containing directory. The Host remains authoritative for canonicalization
 * and workspace fencing; this helper only preserves the document-relative
 * base across POSIX and Windows path spellings.
 */
export function resolveMarkdownImageArtifactPath(markdownPath: string, destination: string): string | undefined {
  const encodedPath = destination.split(/[?#]/, 1)[0]
  if (encodedPath === undefined || encodedPath === '') return undefined
  let relativePath: string
  try {
    relativePath = decodeURIComponent(encodedPath)
  } catch {
    return undefined
  }
  if (
    relativePath === ''
    || relativePath.includes('\0')
    || relativePath.startsWith('/')
    || relativePath.startsWith('\\')
    || /^[A-Za-z][A-Za-z\d+.-]*:/.test(relativePath)
  ) return undefined

  const parent = artifactParentDirectory(markdownPath)
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  const child = relativePath.replaceAll(/[\\/]+/g, separator)
  if (parent === '.') return child
  return `${parent.replace(/[\\/]+$/, '')}${separator}${child.replace(/^[\\/]+/, '')}`
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
