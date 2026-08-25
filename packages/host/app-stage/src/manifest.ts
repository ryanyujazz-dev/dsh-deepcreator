/**
 * Manifest v1 validation — the completeness gate's manifest half.
 *
 * Everything here is pure: parse bytes → {@link AppManifest} or a
 * machine-readable reason. The gate's filesystem half (entry/icon/agentGuide
 * existence) lives in the registry because it needs the source directory.
 *
 * Rejections are explicit and actionable; there is no silent degradation.
 * @module @ryanyujazz/dsh-app-stage/manifest
 */
import type { AppActionDecl, AppEntryReason, AppManifest } from './types.ts'
import { PLATFORM_PROTOCOL } from './types.ts'

/** Whole-manifest size ceiling (64 KiB). */
export const MANIFEST_MAX_BYTES = 64 * 1024
/** Actions per manifest. */
export const ACTIONS_MAX = 32
/** Params per action. */
export const PARAMS_MAX = 16
/** `persist` key paths per action. */
export const PERSIST_MAX = 8
/** Action description ceiling (the writing standard's hard bound). */
export const ACTION_DESCRIPTION_MAX = 120
/** agentGuide size ceiling (32 KiB). */
export const AGENT_GUIDE_MAX_BYTES = 32 * 1024

const KEBAB_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const CAMEL_NAME = /^[a-z][a-zA-Z0-9]*$/
const PARAM_TYPE = /^(string|number|boolean|json)\??$/
const KEY_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function reject(code: AppEntryReason['code'], detail: string, fix: string): AppEntryReason {
  return { code, detail, fix }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function relativePathField(value: unknown, field: string): string | null {
  if (typeof value !== 'string' || value === '') return `${field} must be a non-empty string`
  if (value.startsWith('/') || value.startsWith('\\')) return `${field} must be a directory-relative path, not absolute`
  const segments = value.split(/[/\\]/)
  if (segments.includes('..')) return `${field} must not contain ".." segments`
  if (segments.some(segment => segment === '' || segment === '.')) return `${field} must be a clean relative path`
  return null
}

/**
 * Validate one manifest's parsed JSON against manifest v1.
 * @param appId - The directory name the manifest must agree with.
 * @param raw - Parsed JSON (already JSON.parse'd by the caller).
 * @returns the validated manifest, or the rejection reason.
 */
export function validateManifest(appId: string, raw: unknown): { ok: true; manifest: AppManifest } | { ok: false; reason: AppEntryReason } {
  if (!isRecord(raw)) {
    return { ok: false, reason: reject('manifest.invalid', 'app.json root must be a JSON object', 'Make app.json a JSON object with id/platform/name/version fields.') }
  }
  if (typeof raw.id !== 'string' || raw.id !== appId) {
    return { ok: false, reason: reject('manifest.invalid', `id must equal the directory name "${appId}"`, 'Rename the directory or fix the id so both spell the same kebab-case app id.') }
  }
  if (!KEBAB_ID.test(appId)) {
    return { ok: false, reason: reject('manifest.invalid', `id "${appId}" is not kebab-case`, 'Use lowercase kebab-case: letters, digits, single hyphens, starting with a letter.') }
  }
  if (raw.platform !== PLATFORM_PROTOCOL) {
    if (typeof raw.platform !== 'string') {
      return { ok: false, reason: reject('manifest.invalid', 'platform is required and must be a string', `Set "platform": "${PLATFORM_PROTOCOL}".`) }
    }
    return { ok: false, reason: reject('platform.unsupported', `platform "${raw.platform}" is not supported by this DeepCreator`, `Set "platform": "${PLATFORM_PROTOCOL}" or keep the app on the DeepCreator version it was built for.`) }
  }
  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    return { ok: false, reason: reject('manifest.invalid', 'name must be a non-empty string', 'Give the app a display name (plain text).') }
  }
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) {
    return { ok: false, reason: reject('manifest.invalid', 'version must be a semver string like "0.1.0"', 'Set "version" to MAJOR.MINOR.PATCH (optional prerelease suffix).') }
  }
  for (const [field, max] of [['description', 2000], ['name', 120]] as const) {
    const value = raw[field]
    if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
      return { ok: false, reason: reject('manifest.invalid', `${field} must be a string of at most ${max} characters`, `Shorten ${field}.`) }
    }
  }
  if (raw.entry !== undefined && typeof raw.entry !== 'string') {
    return { ok: false, reason: reject('manifest.invalid', 'entry must be a string when present', 'Point entry at a file inside the app directory, e.g. "index.html".') }
  }
  const entry = raw.entry === undefined ? 'index.html' : raw.entry as string
  const entryError = relativePathField(entry, 'entry')
  if (entryError !== null) return { ok: false, reason: reject('manifest.invalid', entryError, 'Point entry at a file inside the app directory, e.g. "index.html".') }
  if (raw.icon !== undefined) {
    if (typeof raw.icon !== 'string') {
      return { ok: false, reason: reject('manifest.invalid', 'icon must be a string when present', 'Point icon at a file inside the app directory.') }
    }
    const iconError = relativePathField(raw.icon, 'icon')
    if (iconError !== null) return { ok: false, reason: reject('manifest.invalid', iconError, 'Point icon at a file inside the app directory.') }
    if (!/\.(svg|png)$/i.test(raw.icon)) {
      return { ok: false, reason: reject('manifest.invalid', `icon "${raw.icon}" must be an .svg or .png file`, 'Use a vector .svg or raster .png icon; it is loaded through <img>.') }
    }
  }
  if (raw.agentGuide !== undefined) {
    const guideError = relativePathField(raw.agentGuide, 'agentGuide')
    if (guideError !== null) return { ok: false, reason: reject('manifest.invalid', guideError, 'Point agentGuide at a file inside the app directory (default "AGENT.md").') }
  }
  if (raw.dataVersion !== undefined && (typeof raw.dataVersion !== 'string' || raw.dataVersion === '')) {
    return { ok: false, reason: reject('manifest.invalid', 'dataVersion must be a non-empty string', 'Set dataVersion to a stable mode marker, e.g. "1".') }
  }
  if (raw.dev !== undefined && typeof raw.dev !== 'boolean') {
    return { ok: false, reason: reject('manifest.invalid', 'dev must be a boolean when present', 'Drop the field or set true only for workspace development copies.') }
  }
  if (raw.permissions !== undefined && (!Array.isArray(raw.permissions) || raw.permissions.length > 0)) {
    return { ok: false, reason: reject('manifest.invalid', 'permissions is reserved and must be an empty array', 'Remove every permission entry; the field is reserved.') }
  }

  const actions: AppActionDecl[] = []
  const rawActions = raw.actions === undefined ? [] : raw.actions
  if (!Array.isArray(rawActions)) {
    return { ok: false, reason: reject('manifest.invalid', 'actions must be an array when present', 'Declare actions as a list of {name, description, params?} objects.') }
  }
  if (rawActions.length > ACTIONS_MAX) {
    return { ok: false, reason: reject('manifest.invalid', `actions count ${rawActions.length} exceeds ${ACTIONS_MAX}`, `Keep at most ${ACTIONS_MAX} actions per app.`) }
  }
  const actionNames = new Set<string>()
  for (const [index, rawAction] of rawActions.entries()) {
    if (!isRecord(rawAction)) {
      return { ok: false, reason: reject('manifest.invalid', `actions[${index}] must be an object`, 'Each action is {name, description, params?, persist?}.') }
    }
    const name = rawAction.name
    if (typeof name !== 'string' || !CAMEL_NAME.test(name)) {
      return { ok: false, reason: reject('manifest.invalid', `actions[${index}].name must be camelCase`, 'Name actions like createTask or moveCard.') }
    }
    if (actionNames.has(name)) {
      return { ok: false, reason: reject('manifest.invalid', `actions[${index}].name "${name}" duplicates an earlier action`, 'Action names must be unique within the app.') }
    }
    actionNames.add(name)
    const description = rawAction.description
    if (typeof description !== 'string' || description.trim() === '' || description.length > ACTION_DESCRIPTION_MAX) {
      return { ok: false, reason: reject('manifest.invalid', `actions[${index}].description must be 1–${ACTION_DESCRIPTION_MAX} characters`, 'Describe when to use it, what it does, and each param meaning.') }
    }
    const action: { name: string; description: string; params?: Record<string, string>; persist?: string[] } = { name, description }
    const params = rawAction.params === undefined ? undefined : rawAction.params
    if (params !== undefined) {
      if (!isRecord(params)) {
        return { ok: false, reason: reject('manifest.invalid', `actions[${index}].params must be an object`, 'params maps names to "string" | "number" | "boolean" | "json", with "?" marking optional.') }
      }
      const keys = Object.keys(params)
      if (keys.length > PARAMS_MAX) {
        return { ok: false, reason: reject('manifest.invalid', `actions[${index}].params has ${keys.length} keys, over ${PARAMS_MAX}`, `Keep at most ${PARAMS_MAX} params per action.`) }
      }
      const validated: Record<string, string> = {}
      for (const key of keys) {
        const type = params[key]
        if (typeof type !== 'string' || !PARAM_TYPE.test(type)) {
          return { ok: false, reason: reject('manifest.invalid', `actions[${index}].params.${key} type must be one of string|number|boolean|json with optional "?"`, 'Use loose scalar types, e.g. "string" or "json?".') }
        }
        validated[key] = type
      }
      action.params = validated
    }
    const persist = rawAction.persist === undefined ? undefined : rawAction.persist
    if (persist !== undefined) {
      if (!Array.isArray(persist) || persist.some(item => typeof item !== 'string')) {
        return { ok: false, reason: reject('manifest.invalid', `actions[${index}].persist must be an array of key paths`, 'Declare written AppData keys as ["board"] style paths.') }
      }
      if (persist.length > PERSIST_MAX) {
        return { ok: false, reason: reject('manifest.invalid', `actions[${index}].persist has ${persist.length} paths, over ${PERSIST_MAX}`, `Keep at most ${PERSIST_MAX} persist paths per action.`) }
      }
      for (const path of persist) {
        if (typeof path !== 'string' || !KEY_PATH.test(path)) {
          return { ok: false, reason: reject('manifest.invalid', `actions[${index}].persist path "${String(path)}" is not a legal key path`, 'Use dot-separated identifiers, e.g. "board.columns".') }
        }
      }
      action.persist = [...persist as string[]]
    }
    actions.push(action)
  }

  return {
    ok: true,
    manifest: {
      id: appId,
      platform: PLATFORM_PROTOCOL,
      name: raw.name as string,
      version: raw.version as string,
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
      ...(typeof raw.icon === 'string' ? { icon: raw.icon } : {}),
      entry,
      dev: raw.dev === true,
      ...(typeof raw.agentGuide === 'string' ? { agentGuide: raw.agentGuide } : {}),
      ...(typeof raw.dataVersion === 'string' ? { dataVersion: raw.dataVersion } : {}),
      actions,
      permissions: [],
    },
  }
}

/**
 * Parse and validate one manifest file's bytes.
 * @param appId - Directory name the manifest must agree with.
 * @param bytes - Raw app.json bytes.
 * @returns the validated manifest, or the rejection reason.
 */
export function validateManifestBytes(appId: string, bytes: Uint8Array): { ok: true; manifest: AppManifest } | { ok: false; reason: AppEntryReason } {
  if (bytes.byteLength > MANIFEST_MAX_BYTES) {
    return { ok: false, reason: reject('manifest.invalid', `app.json is ${bytes.byteLength} bytes, over ${MANIFEST_MAX_BYTES}`, 'Trim the manifest; large prose belongs in the app or agentGuide.') }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    return { ok: false, reason: reject('manifest.invalid', `app.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, 'Fix the JSON syntax in app.json.') }
  }
  return validateManifest(appId, parsed)
}
