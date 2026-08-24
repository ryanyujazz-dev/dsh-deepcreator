// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ConversationFileCardFile, ConversationFileCardList,
} from '@ryanyujazz/dsh-client-ui-primitives'

afterEach(cleanup)

describe('ConversationFileCardFile', () => {
  it('renders interactive row actions beside rather than inside the file button', () => {
    const view = render(
      <ConversationFileCardList>
        <ConversationFileCardFile path="prototype.html" actions={<button type="button">Open</button>} />
      </ConversationFileCardList>,
    )
    const fileButton = view.getByRole('button', { name: 'prototype.html' })
    const actionButton = view.getByRole('button', { name: 'Open' })

    expect(fileButton.contains(actionButton)).toBe(false)
    expect(fileButton.parentElement).toBe(actionButton.parentElement?.parentElement)
  })

  it('paints file-body hover and focus across the complete row container', () => {
    const stylesheet = readFileSync(resolve(process.cwd(), 'packages/client/ui-primitives/src/ConversationFileCard.module.css'), 'utf8')
    expect(stylesheet).toMatch(/\.fileRow:has\(\.file:hover\),\s*\.fileRow:has\(\.file:focus-visible\)\s*\{[^}]*background:\s*var\(--dsw-alias-interactive-bg-hover\);/)
    expect(stylesheet).toMatch(/\.file:hover\s*\{[^}]*color:\s*var\(--dsw-alias-label-primary\);[^}]*\}/)
    expect(stylesheet).not.toMatch(/\.file:hover\s*\{[^}]*background:/)
  })
})
