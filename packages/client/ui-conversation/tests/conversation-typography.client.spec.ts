import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const chatDirectory = new URL('../src/client/chat/', import.meta.url)
const skeletonDirectory = new URL('../src/client/skeleton/', import.meta.url)
const queueDirectory = new URL('../src/client/queue/', import.meta.url)

function css(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, chatDirectory)), 'utf8')
}

const flowFont = 'font: var(--dsh-conversation-flow-font, var(--dsw-font-markdown-base));'
const composerControlSize = 'font-size: calc(var(--dsw-font-sidebar-font-size, 14px) - 3px);'
const composerControlLineHeight = 'line-height: calc(var(--dsw-font-sidebar-line-height, 22px) - 2px);'

describe('conversation typography', () => {
  it('publishes one transcript font role from the renderer frame', () => {
    const view = css('ChatView.module.css')
    expect(view).toContain(
      '--dsh-conversation-flow-font: var(--dsw-font-markdown-base);',
    )
    expect(view).toContain(
      '--dsh-conversation-flow-line-height: var(--dsw-font-markdown-base-line-height, 24px);',
    )
    expect(css('AssistantMarkdown.module.css')).toContain(flowFont)
  })

  it('does not shadow the Host transcript-size preference at the conversation root', () => {
    const root = readFileSync(
      fileURLToPath(new URL('ConversationRoot.module.css', skeletonDirectory)),
      'utf8',
    )
    expect(root).not.toContain('--dsw-font-markdown-base:')
    expect(root).not.toContain('--dsw-font-markdown-code-block-small:')
    expect(root).not.toContain('--dsw-font-markdown-table:')
    expect(root).not.toContain('--dsw-font-markdown-table-head:')
  })

  it('keeps every conversation-header label on the sidebar text-size role', () => {
    const root = readFileSync(
      fileURLToPath(new URL('ConversationRoot.module.css', skeletonDirectory)),
      'utf8',
    )
    expect(root.match(/font-size: var\(--dsw-font-sidebar-font-size, 12px\);/g)).toHaveLength(5)
    expect(root).toContain('line-height: var(--dsw-font-sidebar-line-height, 18px);')
    expect(root.match(/font-weight: var\(--dsw-font-weight-regular, 400\);/g)).toHaveLength(2)
  })

  it('uses the transcript role for every folded execution-flow presentation', () => {
    for (const name of [
      'ExecDisclosureRow.module.css',
      'ExecutionSlot.module.css',
      'DraftingToolRow.module.css',
      'ReasoningRow.module.css',
      'ContextInjectionRow.module.css',
      'GenericCommandCard.module.css',
      'MessageItem.module.css',
    ]) {
      expect(css(name), name).toContain(flowFont)
    }
  })

  it('pins drafting status text to the active transcript size instead of the exported 16px fallback', () => {
    const drafting = css('DraftingToolRow.module.css')
    expect(drafting).toContain('font-size: var(--dsw-font-markdown-base-font-size, 14px);')
    expect(drafting).toContain('line-height: var(--dsw-font-markdown-base-line-height, 22px);')
    expect(drafting).toContain('font-weight: 400;')
    expect(drafting).not.toContain('transform: translateY')
    expect(drafting).not.toMatch(/\.leading\s*\{/)
  })

  it('keeps expanded structured context on the compact detail role', () => {
    expect(css('ContextInjectionRow.module.css')).toContain(
      'font: var(--dsw-font-markdown-code-block-small);',
    )
  })

  it('keeps the session-stat pills synchronized with the permission control across size settings', () => {
    const permission = readFileSync(
      fileURLToPath(new URL('PermissionSelect.module.css', skeletonDirectory)),
      'utf8',
    )
    const queue = readFileSync(fileURLToPath(new URL('QueueDock.module.css', queueDirectory)), 'utf8')
    for (const source of [permission, css('StatsPills.module.css'), queue]) {
      expect(source).toContain(composerControlSize)
      expect(source).toContain(composerControlLineHeight)
    }
    const dialog = css('stat-dialog.module.css')
    expect(dialog).toContain('font-size: var(--dsh-content-font-size-secondary, 13px);')
    expect(dialog).toContain('line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));')
    expect(css('stat-dialog.module.css')).not.toMatch(/font-size:\s*12px/)
  })
})
