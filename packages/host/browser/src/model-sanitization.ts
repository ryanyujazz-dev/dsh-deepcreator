const SENSITIVE_QUERY_KEY = /(?:^|[-_.])(access[-_]?token|auth(?:orization)?|code|credential|csrf|xsrf|key|logid|nonce|password|rsv_t|secret|session|signature|state|ticket)(?:$|[-_.])/i
const NESTED_URL_KEY = /^(?:back|callback|continue|next|redirect|return)[-_]?url$/i
const SENSITIVE_VALUE_KEY = /^(?:authorization|cookie|set-cookie|password|passwd|otp|one-time-code|payment|card-number|cvv|cvc|client-secret|access-token|refresh-token)$/i

/** Keep navigation useful to the model without copying credentials or opaque tracking payloads into tool logs. */
export function redactBrowserUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { return raw }
  if (url.username !== '' || url.password !== '') { url.username = '[REDACTED]'; url.password = '' }
  for (const [key, value] of [...url.searchParams.entries()]) {
    if (SENSITIVE_QUERY_KEY.test(key) || NESTED_URL_KEY.test(key) || value.length > 96) url.searchParams.set(key, '[REDACTED]')
  }
  const fragment = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  if (SENSITIVE_QUERY_KEY.test(fragment) || fragment.length > 96) url.hash = '#[REDACTED]'
  return url.toString()
}

/** Final model/log boundary. Provider and UI state retain the exact URL; tool output receives the redacted copy. */
export function sanitizeBrowserModelValue(value: unknown, key?: string): unknown {
  if (key !== undefined && SENSITIVE_VALUE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return key === 'url' ? redactBrowserUrl(value) : value
  if (Array.isArray(value)) return value.map(item => sanitizeBrowserModelValue(item))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitizeBrowserModelValue(child, childKey)]))
}
