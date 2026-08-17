/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * row fills share the shell's trailing inset, the stable scrollbar counts
 * inside it, and flat, grouped, and search views keep their intended rhythm.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')
const sidebarRowCss = readFileSync(fileURLToPath(new URL('../../ui-primitives/src/SidebarRow.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)
const sharedRowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(sidebarRowCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  const root = declarations('.root')
  const listArea = declarations('.listArea')
  const list = declarations('.list')

  it('is the scrolling region', () => {
    expect(list).toBeDefined()
    expect(list!.get('overflow-y')).toBe('auto')
  })

  it('counts the themed scrollbar inside the shell trailing inset', () => {
    expect(root?.get('--dsh-session-list-edge-inset')).toBe('var(--dsh-sidebar-inline-padding)')
    expect(root?.get('--dsh-session-list-scrollbar-width')).toBe('8px')
    expect(root?.get('--dsh-session-list-scrollbar-offset')).toBe('2px')
    expect(root?.get('margin')).toBe('var(--dsh-sidebar-section-margin-top, 10px) 0 0')
    expect(root?.get('padding-right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(listArea?.get('margin-left')).toBe('-4px')
    expect(listArea?.get('padding-left')).toBe('4px')
    expect(listArea?.get('margin-right')).toBe('calc(-1 * var(--dsh-session-list-edge-inset))')
    expect(declarations('.fade')?.get('right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(list?.get('margin-right')).toBe('var(--dsh-session-list-scrollbar-offset)')
    expect(list?.get('margin-left')).toBe('-4px')
    expect(list?.get('padding-left')).toBe('4px')
    expect(list?.get('padding-right')).toBe([
      'calc(',
      'var(--dsh-session-list-edge-inset)',
      '- var(--dsh-session-list-scrollbar-width)',
      '- var(--dsh-session-list-scrollbar-offset)',
      ')',
    ].join(' '))
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('reserves the scrollbar whether or not the list overflows', () => {
    expect(list!.get('scrollbar-gutter')).toBe('stable')
  })

  it('gives the independent pinned region the same 10px section rhythm and bounded scrolling', () => {
    const pinned = declarations('.pinnedRegion')
    const pinnedList = declarations('.pinnedList')
    expect(pinned?.get('margin')).toBe('var(--dsh-sidebar-section-margin-top, 10px) 0 0')
    expect(pinned?.get('max-height')).toBe('40%')
    expect(pinned?.get('padding-right')).toBe('var(--dsh-session-list-edge-inset)')
    expect(pinnedList?.get('overflow-y')).toBe('auto')
    expect(pinnedList?.get('scrollbar-gutter')).toBe('stable')
    expect(declarations('.pinnedList > * + *')?.get('margin-top')).toBe('2px')
  })

  it('keeps 2px between rows and 4px between workspace groups', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('4px')
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    const listTopMarker = declarations('.listTopDropIndicator')
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the compact fade, overflow control, search field, and row heights', () => {
    expect(declarations('.fade')?.get('height')).toBe('24px')
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('var(--dsw-sidebar-row-height, 28px)')
    expect(declarations('.searchExpanded')?.get('height')).toBe('var(--dsw-sidebar-row-height, 30px)')
    expect(sharedRowDeclarations('.row')?.get('height')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(sharedRowDeclarations('.row')?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(rowDeclarations('.projectRow .title')?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(rowDeclarations('.projectRow .title')?.get('line-height')).toBe('var(--dsw-font-sidebar-line-height, 18px)')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('0')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('uses one sidebar text role and color-only Workspace-row hover emphasis', () => {
    expect(declarations('.sectionHeader')?.get('height')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(declarations('.sectionHeader')?.get('padding-left')).toBe('8px')
    expect(declarations('.root:not(.rail) .sectionHeader')?.get('margin-top')).toBeUndefined()
    expect(declarations('.sectionLabel')?.get('font-size')).toBe('var(--dsw-font-sidebar-font-size, 12px)')
    expect(declarations('.sectionLabel')?.get('line-height')).toBe('var(--dsw-font-sidebar-line-height, 18px)')
    expect(rowDeclarations('.projectRow')?.get('color')).toBe('var(--dsw-alias-label-tertiary)')
    for (const selector of ['.projectRow.projectRow:hover', '.projectRow.projectRow.menuOpen']) {
      expect(rowDeclarations(selector)?.get('background')).toBe('transparent')
      expect(rowDeclarations(selector)?.get('color')).toBe('var(--dsw-alias-label-primary)')
    }
  })

  it('centers both rail controls while retaining expanded button sizes', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('center')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('28px')
    expect(declarations('.rail .search')?.get('width')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(declarations('.rail .search')?.get('height')).toBe('var(--dsw-sidebar-row-height, 32px)')
    expect(declarations('.rail .searchButton')?.get('width')).toBe('28px')
  })
})
