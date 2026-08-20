/**
 * The one-line contract of the ToolRow summary line as CSS text. jsdom has no
 * layout, so the rendering specs (chat-tool-row.spec.tsx) can pin which spans
 * exist but not whether a narrow row still fits on one line; these read the
 * declarations the layout depends on.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/tool/components/ToolRow.module.css', import.meta.url)), 'utf8')
const bashCss = readFileSync(fileURLToPath(new URL('../src/client/tool/toolviews/bash-sample.module.css', import.meta.url)), 'utf8')
const treeCss = readFileSync(fileURLToPath(new URL('../src/client/tool/ToolCallTree.module.css', import.meta.url)), 'utf8')
/** Declarations only: the sheet's prose names the properties it explains. */
const declarationText = css.replace(/\/\*[\s\S]*?\*\//g, ' ')

function declarations(selector: string): string[] {
  // Anchored at a rule boundary: an unanchored match would silently read a
  // compound rule that merely contains the selector (`.root:hover .summarySuffix`)
  // if one ever lands above the base rule.
  const rule = new RegExp(`(?:^|\\})\\s*\\${selector}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`ToolRow.module.css has no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

describe('ToolRow.module.css summary line', () => {
  it('keeps the summary suffix on one line and unshrunk', () => {
    // `flex: none` stops the box shrinking, not the text wrapping: without
    // `nowrap`, a row too narrow for title + separator + suffix wraps the `+n`
    // onto a second line — the exact case the slot exists to survive.
    expect(declarations('.summarySuffix')).toEqual(expect.arrayContaining([
      'flex: none',
      'white-space: nowrap',
    ]))
  })

  it('leaves the truncation to the summary text alone', () => {
    // The suffix must never ellipsize: a clipped count reads as a smaller
    // number rather than as missing information.
    expect(declarations('.summary')).toEqual(expect.arrayContaining([
      'overflow: hidden',
      'text-overflow: ellipsis',
      'white-space: nowrap',
    ]))
    expect(declarations('.summarySuffix')).not.toEqual(expect.arrayContaining(['text-overflow: ellipsis']))
  })
})

describe('expanded Edit diff', () => {
  it('caps only the card code region through the shared DiffBlock seam', () => {
    expect(css).toMatch(/\.root\[data-variant='edit'\]\s*\{[^}]*--dsl-diff-rows-max-height: 420px;[^}]*\}/s)
  })
})

describe('expanded Read source', () => {
  it('soft-wraps like Artifact and shares the Edit card height budget', () => {
    expect(declarations('.readBody')).toEqual(expect.arrayContaining([
      '--dsl-read-body-max-height: 420px',
      '--dsl-read-overflow-x: hidden',
      '--dsl-read-overflow-y: auto',
      '--dsl-read-white-space: pre-wrap',
      '--dsl-read-overflow-wrap: anywhere',
    ]))
  })
})

describe('execution-flow guide rails', () => {
  it('anchors a Code sub-call branch to its parent icon axis', () => {
    expect(treeCss).toContain('.subCalls::before')
    expect(treeCss).toContain('left: calc(var(--dsh-execflow-icon-axis) - var(--dsh-execflow-title-column))')
    expect(treeCss).toContain('margin: 4px 0 2px var(--dsh-execflow-title-column)')
    expect(treeCss).toContain('padding-left: 0')
    expect(treeCss).not.toContain('border-left: 1px solid var(--dsw-alias-border-l2)')
  })

  it('lets the Bash body wrapper own the unclipped rail', () => {
    expect(bashCss).toContain('.card[data-execflow] .bodyWrap::before')
    expect(bashCss).not.toContain('.card[data-execflow] .terminal::before')
  })

  it('adapts the official Skill row at the Tool tree boundary', () => {
    expect(treeCss).toContain(".callRow[data-execflow] :global([data-tool='skill']) > div:nth-child(2)::before")
    expect(treeCss).toContain(".callRow[data-execflow] :global([data-tool='skill']) > div:nth-child(2) > section")
  })
})
