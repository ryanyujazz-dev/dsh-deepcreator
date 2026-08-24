import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { BrowserRuntimeError } from './errors.ts'

function ipv4Private(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a, b] = parts as [number, number, number, number]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224
}
function ipv6Private(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1]
  if (mapped !== undefined) return ipv4Private(mapped)
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc')
    || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
}
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address)
  return family === 4 ? ipv4Private(address) : family === 6 ? ipv6Private(address) : false
}
function isLoopback(address: string): boolean { return address === '::1' || address.startsWith('127.') || /^::ffff:127\./i.test(address) }
export interface NetworkPolicyOptions { allowPrivateNetwork?: boolean }
export interface AllowedBrowserUrl { href: string; protocol: string; hostname: string }

/** Applied before navigation and again for every provider request/redirect. */
export class BrowserNetworkPolicy {
  constructor(private readonly options: NetworkPolicyOptions = {}) {}
  async assertAllowed(raw: string): Promise<AllowedBrowserUrl> {
    let url: URL
    try { url = new URL(raw) }
    catch { throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `Invalid browser URL: ${raw}`) }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `Browser navigation rejects ${url.protocol} URLs. Only http and https are navigable; serve local files from an http://127.0.0.1 loopback URL and navigate there instead.`, { suggestedNextStep: `To render a local file, serve its directory over http bound to 127.0.0.1 (loopback is allowed, e.g. a background job) or copy the content into the workspace; ${url.protocol}// and every other non-http(s) scheme is rejected for all browser providers before navigation starts.` })
    }
    if (url.hostname.toLowerCase() === 'metadata.google.internal') {
      throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'Cloud metadata addresses are blocked.')
    }
    const addresses = isIP(url.hostname) === 0
      ? await lookup(url.hostname, { all: true, verbatim: true }).catch(() => [])
      : [{ address: url.hostname }]
    if (addresses.length === 0) throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `DNS resolution failed for ${url.hostname}.`)
    for (const { address } of addresses) {
      if (address === '169.254.169.254' || address.toLowerCase() === 'fe80::a9fe:a9fe') {
        throw new BrowserRuntimeError('NAVIGATION_BLOCKED', 'Cloud metadata addresses are blocked.')
      }
      if (isPrivateAddress(address) && !isLoopback(address) && this.options.allowPrivateNetwork !== true) {
        throw new BrowserRuntimeError('NAVIGATION_BLOCKED', `Private network address ${address} is blocked.`)
      }
    }
    return { href: url.href, protocol: url.protocol, hostname: url.hostname }
  }
}
