/**
 * App package import (M6c) — the second install entrance: the same package
 * format and install chain as dev publishing, fed from a directory or a git
 * URL instead of a session workspace.
 *
 * Threat model (adversarial-audit safety#2): an import source is untrusted
 * input. The policy below is the hardened edge; the staging copy behind it
 * reuses the M6a whitelist walk (symlinks never followed, hidden entries and
 * `.git` never enter, byte cap enforced mid-copy).
 */
import { execFile } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { compareVersions } from './publish.ts'
import type { AppPublishPlan } from './types.ts'

const execFileAsync = promisify(execFile)

/** Whole-clone wall clock; a stalled clone is killed, not waited out. */
export const GIT_CLONE_TIMEOUT_MS = 60_000

/**
 * Git transport policy: https only. Every other scheme is refused before any
 * process exists — `file://` and the `ext::`/`ssh://` trick shapes execute
 * helpers or read local paths, `http://` is cleartext.
 */
const ALLOWED_PROTOCOL = 'https:'

/** Literal/parse-level verdicts; DNS-level checks layer on top. */
export interface UrlPolicyResult {
  readonly ok: boolean
  readonly reason?: 'SCHEME' | 'USERINFO' | 'HOST_LITERAL' | 'HOST_RESOLVES_PRIVATE' | 'HOST_UNRESOLVED' | 'MALFORMED'
  readonly detail?: string
}

/** Is this a private/loopback/link-local IPv4 literal? */
function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (match === null) return false
  const octets = match.slice(1).map(Number)
  if (octets.some(octet => octet > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** Is this a loopback/link-local/unique-local IPv6 literal (bracketless)? */
function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  return h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')
}

/**
 * The pure URL policy (unit-testable without DNS): scheme, userinfo, and
 * literal-address checks. `resolved` carries the DNS answers for the
 * hostname when the caller already resolved it.
 */
export function checkUrlPolicy(rawUrl: string, resolved?: readonly string[]): UrlPolicyResult {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, reason: 'MALFORMED', detail: `"${rawUrl}" is not a valid URL.` }
  }
  if (url.protocol !== ALLOWED_PROTOCOL) {
    return { ok: false, reason: 'SCHEME', detail: `Only https:// git URLs may be imported (got "${url.protocol}").` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'USERINFO', detail: 'Credentials embedded in the URL are refused; use a public repository.' }
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return { ok: false, reason: 'HOST_LITERAL', detail: `"${host}" is a local hostname; imports must come from public hosts.` }
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) {
    return { ok: false, reason: 'HOST_LITERAL', detail: `"${host}" is a private, loopback, or link-local address.` }
  }
  if (resolved !== undefined) {
    if (resolved.length === 0) return { ok: false, reason: 'HOST_UNRESOLVED', detail: `"${host}" does not resolve.` }
    if (resolved.some(address => isPrivateIPv4(address) || isPrivateIPv6(address.split('%')[0] ?? ''))) {
      return { ok: false, reason: 'HOST_RESOLVES_PRIVATE', detail: `"${host}" resolves to a private address.` }
    }
  }
  return { ok: true }
}

/**
 * Full policy with the DNS layer: a hostname that resolves (in whole or in
 * part) into private space is refused — no SSRF into the LAN or the host's
 * own metadata endpoints. Residual rebinding risk is accepted and documented:
 * the window is seconds and the target must be a git server.
 */
export async function checkUrlWithDns(rawUrl: string): Promise<UrlPolicyResult> {
  const base = checkUrlPolicy(rawUrl)
  if (!base.ok) return base
  const host = new URL(rawUrl).hostname.replace(/^\[|\]$/g, '')
  if (/^[\d.]+$/.test(host) || host.includes(':')) return base // literal already checked
  try {
    const answers = await lookup(host, { all: true })
    return checkUrlPolicy(rawUrl, answers.map(answer => answer.address))
  } catch {
    return { ok: false, reason: 'HOST_UNRESOLVED', detail: `"${host}" does not resolve.` }
  }
}

/**
 * Hardened shallow clone. argv-only (no shell — no `-arg` injection),
 * prompts disabled so a credential-gated repo fails fast instead of hanging
 * on a terminal that will never answer, depth 1 + single branch to bound the
 * fetch, wall-clock kill. The clone lives in a temp dir that the caller owns
 * and must remove; the staging copy that follows applies the byte cap.
 */
export async function hardenedClone(
  url: string, ref: string | undefined, workRoot: string,
): Promise<{ ok: true; dir: string } | { ok: false; code: 'IMPORT_URL_FORBIDDEN' | 'IMPORT_UNSUPPORTED' | 'GIT_CLONE_FAILED'; message: string }> {
  void workRoot
  const policy = await checkUrlWithDns(url)
  if (!policy.ok) return { ok: false, code: 'IMPORT_URL_FORBIDDEN', message: policy.detail ?? 'URL refused by the import policy.' }
  const dir = await mkdtemp(join(tmpdir(), 'appstage-import-'))
  try {
    await execFileAsync('git', [
      'clone', '--depth', '1', '--single-branch',
      ...(ref === undefined || ref === '' ? [] : ['--branch', ref]),
      '--', url, dir,
    ], {
      timeout: GIT_CLONE_TIMEOUT_MS,
      maxBuffer: 1 << 20,
      killSignal: 'SIGKILL' as const,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    })
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { ok: false, code: 'IMPORT_UNSUPPORTED', message: 'The git command is not available on this machine; import from a directory instead.' }
    }
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, code: 'GIT_CLONE_FAILED', message: `git clone failed: ${detail.slice(0, 400)}` }
  }
  return { ok: true, dir }
}

/**
 * The import plan. Same tiers the approved plan fixed (merging audits F3 +
 * safety#4): an import is always cross-source (no workspace fingerprint can
 * vouch for it), so the tiers are watermark-driven only.
 *
 * - not installed → `first` (approval card with import facts)
 * - above the watermark → `update-cross-source` (light confirm: "this
 *   update comes from an imported package")
 * - identical content already current → `already-installed` (no-op out)
 * - everything else — below/at the watermark, or the same number with
 *   different content — → `update-below-watermark` (hard approval)
 */
export type AppImportPlan = AppPublishPlan | 'already-installed'

export function resolveImportPlan(
  nextVersion: string, nextDigest: string,
  installed: { version: string; digest: string } | undefined,
  watermark: { version: string } | undefined,
): AppImportPlan {
  if (installed === undefined) return 'first'
  if (nextVersion === installed.version && nextDigest === installed.digest) return 'already-installed'
  // Self-sufficient baseline: an absent watermark file falls back to the
  // current version (the read-side fallback lives in readWatermark, but the
  // pure plan must tier correctly no matter which caller feeds it).
  const baseline = watermark === undefined ? installed.version : watermark.version
  return compareVersions(nextVersion, baseline) > 0 ? 'update-cross-source' : 'update-below-watermark'
}
