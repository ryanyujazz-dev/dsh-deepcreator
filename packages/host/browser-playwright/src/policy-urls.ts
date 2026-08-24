/**
 * URL strings extracted from a Playwright call's arguments for network-policy
 * pre-checks. Only absolute URLs with a multi-character scheme and a `//`
 * authority are collected: Windows drive paths (`E:\report.html`) carry a
 * one-letter prefix without `//`, and brokered path tokens (`workspace://`,
 * `artifact://`, `artifact-directory://`) are rewritten to real paths before
 * the policy hook runs, so none of those is a navigable URL here. Strings
 * without an authority (`data:`, `about:`, `javascript:`) are left to the
 * provider so page-content payloads with embedded data URIs keep working.
 */
const URL_PATTERN = /^[a-z][a-z\d+.-]+:\/\//i
const BROKERED_TOKEN_PATTERN = /^(?:workspace|artifact|artifact-directory):/i

function isPolicyUrl(raw: string): boolean {
  return !BROKERED_TOKEN_PATTERN.test(raw) && URL_PATTERN.test(raw)
}

/** Recursively collect navigable URL strings from a call's arguments. */
export function collectPolicyUrls(value: unknown): string[] {
  if (typeof value === 'string') return isPolicyUrl(value) ? [value] : []
  if (Array.isArray(value)) return value.flatMap(collectPolicyUrls)
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(collectPolicyUrls)
  return []
}
