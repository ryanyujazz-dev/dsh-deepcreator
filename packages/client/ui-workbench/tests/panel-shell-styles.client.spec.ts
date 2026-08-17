import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const shell = readFileSync(fileURLToPath(new URL('../../ui-primitives/src/WorkbenchPanelShell.module.css', import.meta.url)), 'utf8')
const tabs = readFileSync(fileURLToPath(new URL('../../ui-primitives/src/WorkbenchPanelTabs.module.css', import.meta.url)), 'utf8')
const mosaic = readFileSync(fileURLToPath(new URL('../src/client/WorkbenchRoot.module.css', import.meta.url)), 'utf8')
const appFrame = readFileSync(fileURLToPath(new URL('../../ui-layout/src/client/AppFrame.module.css', import.meta.url)), 'utf8')
const providerPanels = readFileSync(fileURLToPath(new URL('../../ui-workbench-tools/src/client/Panels.module.css', import.meta.url)), 'utf8')
const rootTsx = readFileSync(fileURLToPath(new URL('../src/client/WorkbenchRoot.tsx', import.meta.url)), 'utf8')

describe('Workbench PanelShell geometry', () => {
  it('owns the four-sided inset, rounded frame and compact Header', () => {
    expect(shell).toContain('margin: 4px')
    expect(shell).toContain('border-radius: 10px')
    expect(shell).toContain('height: 32px')
    expect(shell).toContain('flex: 0 0 32px')
    expect(shell).toContain('.headerActions { margin-left: auto; }')
    expect(shell).not.toContain('border-bottom')
    expect(mosaic).toContain('padding: 4px')
    expect(mosaic).toContain('inset: 4px')
  })

  it('raises every cell card one gray step above the conversation base', () => {
    expect(shell).toContain('background: var(--dsw-specific-sidebar-fill)')
    expect(shell).not.toContain('background: var(--dsw-alias-bg-base)')
    expect(mosaic).toContain('background: var(--dsw-alias-bg-base)')
    // Full-size provider surfaces must show the shell surface instead of
    // repainting the conversation base; the address input keeps its inset fill.
    const terminalRule = providerPanels.match(/\.terminal\s*\{([^}]*)\}/)?.[1] ?? ''
    const diffRule = providerPanels.match(/\.diff\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(terminalRule).not.toContain('background')
    expect(diffRule).not.toContain('background')
  })

  it('keeps inter-card spacing equal to the window-edge inset', () => {
    const trackRule = mosaic.match(/\.trackSplitter\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(trackRule).toContain('width: 8px')
    expect(trackRule).toContain('justify-self: center')
    // Splitters must not reserve layout width between columns or deduct
    // height between stacked cells; they only overlay the margin gap.
    expect(rootTsx).toContain("'0px']")
    expect(rootTsx).not.toContain('SPLITTER_SIZE')
    expect(rootTsx).not.toContain('height: `calc(')
    // Drag fidelity: pointer travel converts through the live geometry, never
    // a hardcoded ratio step.
    expect(rootTsx).not.toContain('/ 200')
    expect(rootTsx).toContain('delta / height')
  })

  it('uses the shared rounded tab surface instead of an active underline', () => {
    expect(tabs).toContain('height: 26px')
    expect(tabs).toContain('border-radius: 6px')
    expect(tabs).toContain('background: var(--dsw-alias-interactive-bg-hover)')
    expect(tabs).toContain('background: var(--dsw-alias-interactive-bg-active)')
    expect(tabs).not.toContain('::after')
    // The first tab's 6px corner is concentric with the card's 10px corner on
    // both axes: 1px border + 3px header padding + 6px horizontally, and
    // 1px border + 3px centering (26px tab in the 32px header) + 6px
    // vertically. Plain titles keep their optical 10px inset through
    // .leading's own 7px.
    expect(shell).toContain('padding: 0 7px 0 3px')
    expect(shell).toContain('padding-left: 7px')
    // Tabs hug their label instead of resting at a fixed width; the close
    // glyph keeps a 7px optical inset instead of touching the pill edge.
    expect(tabs).toContain('flex: 0 1 auto')
    expect(tabs).toContain('max-width: 160px')
    expect(tabs).toContain('margin-right: 4px')
    // Label ink sits ~1px below the em-box center; lift it optically onto
    // the close glyph's centerline (line-height cannot shift it).
    const spanRule = tabs.match(/\.tabLabel span \{([^}]*)\}/)?.[1] ?? ''
    expect(spanRule).toContain('top: -1px')
  })

  it('highlights the tab close glyph on hover without a circular fill', () => {
    const closeHover = tabs.match(/\.tabClose:hover \{([^}]*)\}/)?.[1] ?? ''
    expect(closeHover).toContain('color: var(--dsw-alias-label-primary)')
    expect(closeHover).not.toContain('background')
    const closeRule = tabs.match(/\.tabClose \{([^}]*)\}/)?.[1] ?? ''
    expect(closeRule).not.toContain('border-radius: 50%')
  })

  it('leaves the Mosaic parent and details column visually frameless', () => {
    const detailsRule = appFrame.match(/\.detailsCol\s*\{([^}]*)\}/)?.[1] ?? ''
    const splitterRule = mosaic.match(/\.trackSplitter, \.cellSplitter\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(detailsRule).not.toContain('border')
    expect(splitterRule).toContain('background: transparent')
  })
})
