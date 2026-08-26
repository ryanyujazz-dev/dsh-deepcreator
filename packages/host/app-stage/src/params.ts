/**
 * Invoke param validation (B3): params must match the manifest declaration —
 * no extras, declared types hold, `json` accepts any JSON value. A
 * declaration without a `?` marker still reads as optional at the wire (the
 * marker documents intent for readers); `null` satisfies an optional param.
 * @module @ryanyujazz/dsh-app-stage/params
 */
import type { AppJsonValue } from './types.ts'

/** Validate invoke params against one action's declaration. */
export function validateInvokeParams(params: AppJsonValue, decl: Readonly<Record<string, string> | undefined>): { ok: true } | { ok: false; message: string } {
  if (decl === undefined) {
    if (params === null || (typeof params === 'object' && !Array.isArray(params) && Object.keys(params).length === 0)) return { ok: true }
    return { ok: false, message: `this action declares no params; pass an empty object or none (got ${JSON.stringify(params)}).` }
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, message: 'params must be a JSON object matching the declared keys.' }
  }
  for (const [key, value] of Object.entries(params)) {
    const type = decl[key]
    if (type === undefined) return { ok: false, message: `param "${key}" is not declared; declared keys: ${Object.keys(decl).join(', ') || '(none)'}.` }
    const optional = type.endsWith('?')
    const base = optional ? type.slice(0, -1) : type
    if (value === null && optional) continue
    if (base === 'json') continue
    if (typeof value !== base) return { ok: false, message: `param "${key}" must be ${base} (got ${typeof value}).` }
  }
  return { ok: true }
}
