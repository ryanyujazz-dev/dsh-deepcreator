import {
  DEFAULT_FILE_ICON,
  FILE_EXTENSION_ICONS,
  FILE_ICON_SOURCES,
  FILE_NAME_ICONS,
  LIGHT_FILE_EXTENSION_ICONS,
  LIGHT_FILE_NAME_ICONS,
} from './generated.ts'

export interface ResolvedFileIcon {
  /** Material Icon Theme definition used in dark application appearance. */
  readonly name: string
  readonly source: string
  /** Material Icon Theme definition used in light application appearance. */
  readonly lightName: string
  readonly lightSource: string
}

function normalizedPath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
}

/** Most-specific relative suffix first, then the basename. */
function fileNameCandidates(path: string): string[] {
  const parts = path.split('/').filter(part => part !== '')
  return parts.map((_part, index) => parts.slice(index).join('/'))
}

/** Longest compound extension first (`schema.json` before `json`). */
function extensionCandidates(path: string): string[] {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  const candidates: string[] = []
  let dot = basename.indexOf('.')
  while (dot !== -1 && dot < basename.length - 1) {
    candidates.push(basename.slice(dot + 1))
    dot = basename.indexOf('.', dot + 1)
  }
  return candidates
}

function firstIcon(candidates: readonly string[], primary: Readonly<Record<string, string>>, fallback: Readonly<Record<string, string>>): string | undefined {
  for (const candidate of candidates) {
    const icon = primary[candidate] ?? fallback[candidate]
    if (icon !== undefined) return icon
  }
  return undefined
}

function iconSource(name: string): string {
  const source = FILE_ICON_SOURCES[name] ?? FILE_ICON_SOURCES[DEFAULT_FILE_ICON]
  if (source === undefined) throw new Error(`Missing generated Material file icon: ${name}`)
  return source
}

function resolveName(path: string, light: boolean): string {
  const names = fileNameCandidates(path)
  const extensions = extensionCandidates(path)
  if (light) {
    return firstIcon(names, LIGHT_FILE_NAME_ICONS, FILE_NAME_ICONS)
      ?? firstIcon(extensions, LIGHT_FILE_EXTENSION_ICONS, FILE_EXTENSION_ICONS)
      ?? DEFAULT_FILE_ICON
  }
  return firstIcon(names, FILE_NAME_ICONS, {})
    ?? firstIcon(extensions, FILE_EXTENSION_ICONS, {})
    ?? DEFAULT_FILE_ICON
}

/**
 * Resolve one local path through Material Icon Theme's native filename and
 * compound-extension associations. Path separators and matching case are
 * normalized so the same file looks identical on Windows, macOS and Linux.
 */
export function resolveFileIcon(path: string): ResolvedFileIcon {
  const normalized = normalizedPath(path)
  const name = resolveName(normalized, false)
  const lightName = resolveName(normalized, true)
  return {
    name,
    source: iconSource(name),
    lightName,
    lightSource: iconSource(lightName),
  }
}
