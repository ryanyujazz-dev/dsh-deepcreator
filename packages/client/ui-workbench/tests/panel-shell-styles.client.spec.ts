import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(fileURLToPath(new URL('../../ui-primitives/src/WorkbenchPanelShell.module.css', import.meta.url)), 'utf8')
const tabs = readFileSync(fileURLToPath(new URL('../../ui-primitives/src/WorkbenchPanelTabs.module.css', import.meta.url)), 'utf8')
const mosaic = readFileSync(fileURLToPath(new URL('../src/client/WorkbenchRoot.module.css', import.meta.url)), 'utf8')
const appFrame = readFileSync(fileURLToPath(new URL('../../ui-layout/src/client/AppFrame.module.css', import.meta.url)), 'utf8')

describe('Workbench PanelShell geometry', () => {
  it('owns the four-sided inset, rounded frame and compact Header', () => {
    expect(shell).toContain('margin: 2px')
    expect(shell).toContain('border-radius: 10px')
    expect(shell).toContain('height: 42px')
    expect(shell).toContain('flex: 0 0 42px')
    expect(shell).toContain('.headerActions { margin-left: auto; }')
    expect(shell).not.toContain('border-bottom')
    expect(mosaic).toContain('padding: 2px')
    expect(mosaic).toContain('inset: 2px')
  })

  it('uses the shared rounded tab surface instead of an active underline', () => {
    expect(tabs).toContain('border-radius: 10px')
    expect(tabs).toContain('background: var(--dsw-alias-interactive-bg-hover)')
    expect(tabs).toContain('background: var(--dsw-alias-interactive-bg-active)')
    expect(tabs).not.toContain('::after')
  })

  it('leaves the Mosaic parent and details column visually frameless', () => {
    const detailsRule = appFrame.match(/\.detailsCol\s*\{([^}]*)\}/)?.[1] ?? ''
    const splitterRule = mosaic.match(/\.trackSplitter, \.cellSplitter\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(detailsRule).not.toContain('border')
    expect(splitterRule).toContain('background: transparent')
  })
})
