/** Import policy (M6c): URL hardening matrix + watermark-tiered plan. */
import { describe, expect, it } from 'vitest'
import { checkUrlPolicy, resolveImportPlan } from '../src/import.ts'

describe('import URL policy', () => {
  const forbidden = [
    'file:///etc/passwd',
    'file:///Users/x/repo',
    'ext::sh -c id',
    'ssh://git@github.com/o/r',
    'git://github.com/o/r',
    'http://github.com/o/r',
    'https://user:pass@example.com/o/r',
    'https://127.0.0.1/o/r',
    'https://10.1.2.3/o/r',
    'https://172.16.0.1/o/r',
    'https://192.168.1.1/o/r',
    'https://169.254.169.254/latest/meta-data',
    'https://0.0.0.0/o/r',
    'https://[::1]/o/r',
    'https://[fe80::1]/o/r',
    'https://[fd12::]/o/r',
    'https://localhost/o/r',
    'https://box.local/o/r',
    'https://git.internal/o/r',
    'not a url',
  ]
  it('refuses every non-https, credentialed, or local shape', () => {
    for (const url of forbidden) {
      const verdict = checkUrlPolicy(url)
      expect(verdict.ok, url).toBe(false)
    }
  })
  it('admits public https hosts and honors DNS answers', () => {
    expect(checkUrlPolicy('https://github.com/o/r').ok).toBe(true)
    expect(checkUrlPolicy('https://example.com/o/r.git').ok).toBe(true)
    // DNS layer: public name resolving into private space is refused.
    expect(checkUrlPolicy('https://rebind.example.com/o', ['10.0.0.5']).ok).toBe(false)
    expect(checkUrlPolicy('https://rebind.example.com/o', ['93.184.216.34']).ok).toBe(true)
    expect(checkUrlPolicy('https://ghost.example.com/o', []).reason).toBe('HOST_UNRESOLVED')
  })
})

describe('import plan tiers', () => {
  it('not installed → first; above watermark → light confirm; identical → no-op; rest → hard approval', () => {
    expect(resolveImportPlan('0.1.0', 'd1', undefined, undefined)).toBe('first')
    const installed = { version: '0.1.0', digest: 'd1' }
    // Genuine update above the watermark: light confirm (import is always cross-source).
    expect(resolveImportPlan('0.4.0', 'd4', installed, { version: '0.3.0' })).toBe('update-cross-source')
    // Same number, same content: no-op.
    expect(resolveImportPlan('0.1.0', 'd1', installed, { version: '0.3.0' })).toBe('already-installed')
    // Below/at the watermark (incl. after a rollback): hard approval.
    expect(resolveImportPlan('0.2.0', 'd2-new', installed, { version: '0.3.0' })).toBe('update-below-watermark')
    // Same number as current, different content: hard approval (supply-chain guard).
    expect(resolveImportPlan('0.1.0', 'd1-evil', installed, { version: '0.3.0' })).toBe('update-below-watermark')
    // Lower than current: also below the watermark by definition — hard approval, not rejection.
    expect(resolveImportPlan('0.0.9', 'd0', installed, { version: '0.3.0' })).toBe('update-below-watermark')
    // Legacy install without a watermark file: next > current flows light.
    expect(resolveImportPlan('0.2.0', 'd2', installed, undefined)).toBe('update-cross-source')
  })
})
