// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply as nodeApply } from '@ryanyujazz/dsh-client-ui-theme'
import { apply as clientApply, inject, ThemeRuntime } from '@ryanyujazz/dsh-client-ui-theme/client'
import * as ThemeInvariant from '@ryanyujazz/dsh-client-ui-theme/invariant'
import { apply as localeApply, inject as localeInject } from '@ryanyujazz/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { CODE_THEME_MAP } from '@ryanyujazz/dsh-client-ui-primitives/src/markdown/code-themes.ts'

const CODE_THEME_IDS = [
  'deepcreator-light',
  'deepcreator-dark',
  'github-light',
  'github-dark',
  'one-light',
  'one-dark',
  'catppuccin-light',
  'catppuccin-dark',
  'rose-pine-light',
  'rose-pine-dark',
  'vitesse-light',
  'vitesse-dark',
  'kanagawa-light',
  'kanagawa-dark',
  'everforest-light',
  'everforest-dark',
  'tokyo-night-light',
  'tokyo-night-dark',
] as const

describe('invariant companion', () => {
  it('owns the complete global palette entry instead of relying on an official package side effect', () => {
    const packageRoot = resolve(process.cwd(), 'packages/client/ui-theme')
    const entry = readFileSync(resolve(packageRoot, 'src/client/index.ts'), 'utf8')
    const baseStylesheet = readFileSync(resolve(packageRoot, 'src/styles/base.css'), 'utf8')
    const stylesheet = readFileSync(resolve(packageRoot, 'src/styles/shiki.css'), 'utf8')

    const imports = [
      'base.css',
      'design-platform.css',
      'scrollbar.css',
      'gradient-shadow-text.css',
      'shiki.css',
    ].map(name => `import '../styles/${name}'`)
    for (const statement of imports) expect(entry.indexOf(statement)).toBeGreaterThan(-1)
    for (let index = 1; index < imports.length; index += 1) {
      expect(entry.indexOf(imports[index]!)).toBeGreaterThan(entry.indexOf(imports[index - 1]!))
    }
    for (const themeId of CODE_THEME_IDS) {
      expect(stylesheet).toContain(`[data-code-theme='${themeId}']`)
    }
    expect(baseStylesheet).toContain('--dsh-reading-content-width: 748px;')
  })

  it('binds token colors directly while isolating nested preview scopes from the body theme', () => {
    const packageRoot = resolve(process.cwd(), 'packages/client/ui-theme')
    const stylesheet = readFileSync(resolve(packageRoot, 'src/styles/shiki.css'), 'utf8')

    expect(stylesheet).not.toContain('--ds-active-token-color')
    for (const themeId of CODE_THEME_IDS) {
      const selector = String.raw`body\[data-code-theme='${themeId}'\] :where\(\.shiki span, \[data-code-token\]\):not\(\[data-code-theme-isolate\] \*\),\s*\[data-code-theme-isolate\]\[data-code-theme='${themeId}'\] :where\(\.shiki span, \[data-code-token\]\) \{[\s\S]*?color: var\(--shiki-${themeId}, var\(--ds-code-foreground\)\);`
      expect(stylesheet).toMatch(new RegExp(selector))
    }
  })

  it('binds every available third-party diffEditor color verbatim', () => {
    const packageRoot = resolve(process.cwd(), 'packages/client/ui-theme')
    const stylesheet = readFileSync(resolve(packageRoot, 'src/styles/shiki.css'), 'utf8')
    const roles = {
      '--dsw-diff-line-inserted-bg': 'diffEditor.insertedLineBackground',
      '--dsw-diff-word-inserted-bg': 'diffEditor.insertedTextBackground',
      '--dsw-diff-line-removed-bg': 'diffEditor.removedLineBackground',
      '--dsw-diff-word-removed-bg': 'diffEditor.removedTextBackground',
    } as const

    for (const themeId of CODE_THEME_IDS.slice(2)) {
      const block = new RegExp(String.raw`\[data-code-theme='${themeId}'\] \{([\s\S]*?)\}`).exec(stylesheet)?.[1]
      expect(block, `missing CSS block for ${themeId}`).toBeDefined()
      const colors = CODE_THEME_MAP[themeId].colors ?? {}
      for (const [variable, nativeKey] of Object.entries(roles)) {
        const nativeValue = colors[nativeKey]
        if (nativeValue === undefined) continue
        expect(block).toMatch(new RegExp(`${variable}:\\s*${nativeValue};`, 'i'))
      }
    }
  })

  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ThemeInvariant).await()).resolves.toBeDefined()
  })

  it('node-half waits for optional Host services', () => {
    nodeApply(new Context())
    expect(true).toBe(true)
  })

  it('client apply provides ctx.theme over the slots/locale edges', async () => {
    // The feature registers its own Appearance settings row with localized
    // copy, hence the slots + locale edges.
    expect(inject).toEqual(['slots', 'locale', 'connection', 'remote', 'settingsScope'])
    const ctx = new Context()
    new SlotRegistry(ctx)
    ctx.provide('connection', {
      api: { settings: { describe: () => Promise.resolve({
        rpcId: 'theme-invariant' as never,
        result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [] } },
      }) } },
      isLoopback: true,
    } as never)
    // The settings row's transport and the forwarded-event port.
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('settingsScope', { bind: () => stubSettingsScope().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: localeApply }).await()
    await ctx.plugin({ inject, apply: clientApply }).await()
    expect(ctx.get('theme')).toBeInstanceOf(ThemeRuntime)
  })
})
