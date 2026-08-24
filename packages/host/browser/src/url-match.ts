import type { BrowserUrlMatch } from './types.ts'

function escapeRegex(value: string): string { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&') }

/** One URL-pattern contract shared by Browser Core and in-process Providers. */
export function matchBrowserUrl(url: string, pattern: string, mode?: BrowserUrlMatch): boolean {
  const resolved = mode ?? (pattern.includes('*') ? 'glob' : 'contains')
  if (resolved === 'exact') return url === pattern
  if (resolved === 'contains') return url.includes(pattern)
  const source = escapeRegex(pattern).replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')
  return new RegExp(`^${source}$`).test(url)
}
